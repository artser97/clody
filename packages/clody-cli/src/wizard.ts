// packages/clody-cli/src/wizard.ts
/**
 * Interactive first-run wizard. planSetup is the pure decision seam; runWizard
 * renders it with @clack/prompts and drives the core IO (install, pull, probe,
 * config write).
 */
import * as p from "@clack/prompts"
import { printBanner } from "./banner"
import * as style from "./style"
import pkg from "../package.json" with { type: "json" }
import {
  detectHardware,
  deriveRamCeiling,
  recommendModels,
  isOllamaRunning,
  ensureOllama,
  planOllamaInstall,
  runInstall,
  pullModel,
  probeModel,
  saveClodyConfig,
  getModelProfile,
  chooseNumCtx,
  DEFAULT_CONFIG_PATH,
  type Hardware,
  type ProbeResult,
  type ClodyConfig,
} from "@clody/core"

export interface SetupInputs {
  hardware: Hardware
  model: string
  probe: ProbeResult
}

export type SetupPlan =
  | { action: "write"; config: Partial<ClodyConfig> }
  | { action: "reprompt"; reason: string }

const EMBEDDING_MODEL = "nomic-embed-text"

export function planSetup(inputs: SetupInputs): SetupPlan {
  if (!inputs.probe.toolCalling) {
    return { action: "reprompt", reason: `${inputs.model} did not call tools in the probe` }
  }
  return {
    action: "write",
    config: {
      model: inputs.model,
      ramCeilingGB: deriveRamCeiling(inputs.hardware.ramGB),
      embeddingModel: EMBEDDING_MODEL,
    },
  }
}

function accelLabel(hw: Hardware): string {
  return hw.accelerator === "metal" ? "Metal" : hw.accelerator === "cuda" ? "CUDA" : "CPU"
}

async function pullWithSpinner(ollamaUrl: string, tag: string): Promise<boolean> {
  const spin = p.spinner()
  spin.start(`Pulling ${tag}`)
  try {
    const ok = await pullModel(ollamaUrl, tag, (prog) => {
      if (prog.fraction !== null) {
        spin.message(`Pulling ${tag}  ${style.bar(prog.fraction, 16)}  ${Math.round(prog.fraction * 100)}%`)
      } else {
        spin.message(`Pulling ${tag}`)
      }
    })
    spin.stop(ok ? `Pulled ${tag}` : `Failed to pull ${tag}`)
    return ok
  } catch {
    spin.stop(`Failed to pull ${tag}`)
    return false
  }
}

/** Runs the wizard. `modelOnly` skips the Ollama-install step (used by `clody model`). */
export async function runWizard(ollamaUrl: string, modelOnly = false): Promise<boolean> {
  const hardware = detectHardware()
  printBanner({ version: pkg.version, accelerator: accelLabel(hardware) })
  console.log(style.rule("SETUP"))

  if (!modelOnly && !(await isOllamaRunning(ollamaUrl))) {
    const plan = planOllamaInstall(process.platform)
    if (!plan) {
      p.note("Install Ollama from https://ollama.com/download, then re-run clody.", "Ollama not found")
      return false
    }
    const go = await p.confirm({ message: `Ollama isn't installed. Run \`${plan.human}\`?` })
    if (p.isCancel(go) || !go) {
      p.note(`Run:  ${plan.human}\nthen re-run clody.`, "Manual install")
      return false
    }
    const spin = p.spinner()
    spin.start("Installing Ollama")
    const code = await runInstall(plan, () => {})
    spin.stop(code === 0 ? "Ollama installed" : "Install failed")
    if (code !== 0) {
      p.note(`Run:  ${plan.human}\nthen re-run clody.`, "Manual install")
      return false
    }
  }

  p.note(
    `${hardware.ramGB} GB RAM · ${hardware.cores} cores · ${accelLabel(hardware)}`,
    "Hardware",
  )

  // Model pick + probe loop.
  for (;;) {
    const ranked = recommendModels(hardware)
    const def = ranked.find((r) => r.isDefault)
    const choice = await p.select({
      message: "Which model would you like?",
      initialValue: def?.model.tag ?? ranked[0]!.model.tag,
      options: ranked.map((r) => ({
        value: r.model.tag,
        label: `${r.model.tag}  ${r.isDefault ? "★ recommended" : r.model.blurb}`,
        hint: r.verdict === "too-big" ? "too big for your RAM" : `${r.model.weightsGB} GB · ${r.verdict}`,
      })),
    })
    if (p.isCancel(choice)) {
      p.cancel("Setup cancelled.")
      return false
    }
    const model = choice

    // Ensure Ollama is up with a context length that fits the chosen model.
    const profile = getModelProfile(model)
    const ctx = chooseNumCtx(profile, deriveRamCeiling(hardware.ramGB), 32000)
    const up = await ensureOllama({ model, ollamaUrl, contextLength: ctx, log: () => {} })
    if (!up) {
      p.cancel("Could not start Ollama. Is it installed?")
      return false
    }

    if (!(await pullWithSpinner(ollamaUrl, model))) {
      const retry = await p.confirm({ message: "Pull failed. Pick a different model?" })
      if (p.isCancel(retry) || !retry) { p.cancel("Setup cancelled."); return false }
      continue
    }
    const embOk = await pullWithSpinner(ollamaUrl, EMBEDDING_MODEL)
    if (!embOk) p.log.warn(`Could not pull ${EMBEDDING_MODEL}. Skill routing will be unavailable.`)

    const spin = p.spinner()
    spin.start(`Probing ${model}`)
    const probe = await probeModel(ollamaUrl, model)
    spin.stop(probe.toolCalling ? `Probe OK · tools ✓` : `Probe: ${model} cannot call tools`)

    const plan = planSetup({ hardware, model, probe })
    if (plan.action === "reprompt") {
      const again = await p.confirm({ message: `${plan.reason}. Pick a different model?` })
      if (p.isCancel(again) || !again) { p.cancel("Setup cancelled."); return false }
      continue
    }

    await saveClodyConfig(DEFAULT_CONFIG_PATH, {
      ...plan.config,
      ollamaUrl,
      probes: {
        [model]: {
          streaming: probe.streaming,
          toolCalling: probe.toolCalling,
          parallelToolCalls: probe.parallelToolCalls,
          reasoningStyle: probe.reasoningStyle,
          probedAt: new Date().toISOString(),
        },
      },
    })
    p.outro(`Ready. Launching clody with ${model}…`)
    return true
  }
}
