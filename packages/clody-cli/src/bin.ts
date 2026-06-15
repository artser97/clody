#!/usr/bin/env bun
/**
 * clody — ensure Ollama, probe the model (cached), generate slim opencode
 * config, launch the forked opencode TUI in the user's cwd.
 * Extra argv is passed through (e.g. `clody run "fix the bug"`).
 */
import { homedir } from "node:os"
import { join } from "node:path"
import pkg from "../package.json" with { type: "json" }
import {
  loadClodyConfig,
  saveClodyConfig,
  saveProbeResult,
  DEFAULT_CONFIG_PATH,
  probeModel,
  getModelProfile,
  chooseNumCtx,
  ensureOllama,
  isOllamaRunning,
  pullModel,
  readLoadedContextLength,
  configFileExists,
  detectHardware,
  CORE_TOOLS,
  type ProbeResult,
} from "@clody/core"
import { scanSkills, SkillRouter, OllamaEmbedder, DEFAULT_SKILL_DIRS } from "@clody/context"
import { writeOpencodeSetup } from "./setup"
import { confirmSkills } from "./skills-prompt"
import { confirmTools } from "./tools-prompt"
import { selectSkills, toClodySkillsValue } from "./skill-selector"
import { runWizard } from "./wizard"
import { printBanner } from "./banner"
import * as style from "./style"
import { formatProbeReport, toProbeRow, type ProbeRow } from "./probe-report"

const OPENCODE_ENTRY = new URL("../../opencode/src/index.ts", import.meta.url).pathname
// clody: opencode's TUI is solid-js; its JSX runtime is registered by
// @opentui/solid's preload, declared in packages/opencode/bunfig.toml. We launch
// opencode from the user's cwd, so that bunfig never loads — inject the preload
// explicitly, or the TUI crashes resolving react/jsx-dev-runtime.
const OPENCODE_DIR = new URL("../../opencode/", import.meta.url).pathname
let SOLID_PRELOAD: string | null = null
try {
  SOLID_PRELOAD = Bun.resolveSync("@opentui/solid/preload", OPENCODE_DIR)
} catch {
  /* preload unresolved — let opencode surface its own error rather than guess */
}

export interface EntryContext {
  configExists: boolean
  isTTY: boolean
}

export type EntryDecision =
  | { kind: "wizard"; modelOnly: boolean }
  | { kind: "fail-no-config" }
  | { kind: "launch" }
  | { kind: "probe" }

export function decideEntry(argv: string[], ctx: EntryContext): EntryDecision {
  if (argv[0] === "probe") return { kind: "probe" }
  if (argv[0] === "init") return { kind: "wizard", modelOnly: false }
  if (argv[0] === "model") return { kind: "wizard", modelOnly: true }
  if (!ctx.configExists) {
    return ctx.isTTY ? { kind: "wizard", modelOnly: false } : { kind: "fail-no-config" }
  }
  return { kind: "launch" }
}

async function runProbeReport(ollamaUrl: string, tags: string[]): Promise<number> {
  if (!(await isOllamaRunning(ollamaUrl))) {
    const up = await ensureOllama({ model: tags[0]!, ollamaUrl, contextLength: 8192 })
    if (!up) {
      style.err("Could not start Ollama — is it installed?")
      return 1
    }
  }
  console.log(style.rule("PROBE"))
  const rows: ProbeRow[] = []
  for (const tag of tags) {
    style.step(`Pulling ${tag}…`)
    let pulled = false
    try {
      // onProgress is required and invoked per streamed line — emit only on status
      // change so a multi-GB pull doesn't spam the report.
      let lastStatus = ""
      pulled = await pullModel(ollamaUrl, tag, (p) => {
        if (p.status === lastStatus) return
        lastStatus = p.status
        const pct = p.fraction !== null ? ` ${Math.round(p.fraction * 100)}%` : ""
        style.step(`${tag}: ${p.status}${pct}`)
      })
    } catch {
      pulled = false
    }
    if (!pulled) {
      rows.push({
        tag,
        streaming: false,
        toolCalling: false,
        parallelToolCalls: false,
        reasoningStyle: "none",
        latencyMs: 0,
        error: "pull failed",
      })
      continue
    }
    style.step(`Probing ${tag}…`)
    rows.push(toProbeRow(tag, await probeModel(ollamaUrl, tag)))
  }
  console.log("\n" + formatProbeReport(rows))
  return 0
}

async function main(): Promise<number> {
  const passthroughArgs = process.argv.slice(2)
  const decision = decideEntry(passthroughArgs, {
    configExists: await configFileExists(),
    isTTY: process.stdin.isTTY ?? false,
  })
  if (decision.kind === "probe") {
    const cfg = await loadClodyConfig()
    const tags = passthroughArgs.slice(1).filter((a) => !a.startsWith("-"))
    return await runProbeReport(cfg.ollamaUrl, tags.length > 0 ? tags : [cfg.model])
  }
  if (decision.kind === "fail-no-config") {
    style.err("No config and not a TTY. Run `clody init` interactively first.")
    return 1
  }
  if (decision.kind === "wizard") {
    // Load only for ollamaUrl; the wizard may write a new model, re-loaded as `cfg` below.
    const cfgForUrl = await loadClodyConfig()
    const ok = await runWizard(cfgForUrl.ollamaUrl, decision.modelOnly)
    if (!ok) return 1
    if (passthroughArgs[0] === "init" || passthroughArgs[0] === "model") return 0
  }

  const cfg = await loadClodyConfig()
  const profile = getModelProfile(cfg.model)
  const contextLength = chooseNumCtx(profile, cfg.ramCeilingGB, cfg.maxContextTokens)
  if (contextLength < cfg.maxContextTokens) {
    style.warn(
      `RAM ceiling ${cfg.ramCeilingGB}GB limits ${cfg.model} to a ${contextLength}-token context ` +
        `(config asks for ${cfg.maxContextTokens}).`,
    )
  }

  const ok = await ensureOllama({ model: cfg.model, ollamaUrl: cfg.ollamaUrl, contextLength })
  if (!ok) return 1

  let probe: ProbeResult
  const cached = process.env["CLODY_REPROBE"] ? undefined : cfg.probes[cfg.model]
  if (cached) {
    probe = { ...cached, latencyMs: 0 }
    style.step(`Using cached probe for ${cfg.model} (${cached.probedAt}). Set CLODY_REPROBE=1 to re-run.`)
  } else {
    style.step(`Probing ${cfg.model}…`)
    probe = await probeModel(cfg.ollamaUrl, cfg.model)
    if (probe.error) {
      style.err(`Probe failed: ${probe.error} — refusing to launch silently degraded.`)
      return 1
    }
    if (probe.toolCalling) {
      // Only cache positive results: a model that skipped tools once shouldn't
      // be branded forever (local models are stochastic — Phase A review).
      await saveProbeResult(DEFAULT_CONFIG_PATH, cfg.model, probe)
    }
  }
  if (!probe.toolCalling) {
    style.err(`${cfg.model} did not call tools in the probe — agentic coding will not work.`)
    style.err("This result was NOT cached. Retry, or set CLODY_REPROBE=1 to force a fresh probe.")
    return 1
  }

  let effectiveContext = contextLength
  const loadedCtx = await readLoadedContextLength(cfg.ollamaUrl, cfg.model)
  if (loadedCtx !== null && loadedCtx < contextLength) {
    style.warn(
      `Ollama loaded ${cfg.model} with a ${loadedCtx}-token context (likely an externally-started ` +
        `daemon). Advertising ${loadedCtx} to opencode instead of ${contextLength}.`,
    )
    effectiveContext = loadedCtx
  }

  await writeOpencodeSetup({
    configDir: join(homedir(), ".config", "opencode"),
    model: cfg.model,
    ollamaUrl: cfg.ollamaUrl,
    contextTokens: effectiveContext,
    outputTokens: cfg.outputTokens,
    probe,
  })

  // Filter init/model subcommands so they are not forwarded to opencode.
  const passthrough = (passthroughArgs[0] === "init" || passthroughArgs[0] === "model")
    ? passthroughArgs.slice(1)
    : passthroughArgs

  if (!process.env["CLODY_JUDGE"]) {
    const oneShot = passthrough[0] === "run"
    if (cfg.judgeMode === "off" || (cfg.judgeMode === "tui" && oneShot)) {
      process.env["CLODY_JUDGE"] = "0"
    }
  }

  // Skill confirm: only for an interactive `clody run "<task>"` without an explicit override.
  if (passthrough[0] === "run" && process.stdin.isTTY && !process.env["CLODY_SKILLS"]) {
    const taskText = passthrough.slice(1).filter((a) => !a.startsWith("-")).join(" ")
    if (taskText.trim().length > 0) {
      try {
        const skills = await scanSkills(DEFAULT_SKILL_DIRS)
        if (skills.length > 0) {
          const router = new SkillRouter(
            new OllamaEmbedder(cfg.ollamaUrl, cfg.embeddingModel),
            join(homedir(), ".clody", "ctx", "skill-vectors.json"),
            cfg.embeddingModel,
          )
          const matches = await router.route(taskText, skills, { limit: 3, threshold: cfg.skillThreshold })
          if (matches.length > 0) {
            process.env["CLODY_SKILLS"] = await confirmSkills(matches)
          }
        }
      } catch (err) {
        style.warn(`Skill routing unavailable: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  // clody: session-start skill selector for the TUI. Replaces the old blanket
  // "none" default: on an interactive TTY, let the user pick from all discovered
  // skills (pre-ticking last session's choice) so they load exactly what their
  // work needs; persist the pick. Non-TTY or any error -> "none". `clody run` and
  // an explicit CLODY_SKILLS env both bypass this.
  if (!process.env["CLODY_SKILLS"] && passthrough[0] !== "run") {
    if (process.stdin.isTTY) {
      try {
        const skills = await scanSkills(DEFAULT_SKILL_DIRS)
        const value = await selectSkills(skills, cfg.skills)
        if (value === null) {
          // cancelled (Esc): keep last session's saved pick, change nothing on disk.
          process.env["CLODY_SKILLS"] = toClodySkillsValue(cfg.skills)
        } else {
          process.env["CLODY_SKILLS"] = value
          const picked = value === "none" ? [] : value.split(",")
          // Persist only when the pick changed — avoid rewriting config every launch.
          if (picked.join(",") !== cfg.skills.join(",")) {
            await saveClodyConfig(DEFAULT_CONFIG_PATH, { skills: picked }).catch(() => {})
          }
        }
      } catch (err) {
        style.warn(`Skill selection unavailable: ${err instanceof Error ? err.message : String(err)}`)
        process.env["CLODY_SKILLS"] = "none"
      }
    } else {
      process.env["CLODY_SKILLS"] = "none"
    }
  }

  // clody: per-task TOOL selection — fewer tools = fewer tool-schema tokens for
  // the local model. A config `tools` default applies everywhere (incl. the TUI);
  // `clody run` lets you pick interactively. CLODY_TOOLS="" / unset = all tools.
  if (!process.env["CLODY_TOOLS"] && cfg.tools.length > 0) {
    process.env["CLODY_TOOLS"] = cfg.tools.join(",")
  }
  if (passthrough[0] === "run" && process.stdin.isTTY && process.env["CLODY_TOOLS"] === undefined) {
    process.env["CLODY_TOOLS"] = await confirmTools(CORE_TOOLS)
  }

  if (process.stdout.isTTY) {
    const hw = detectHardware()
    const accel = hw.accelerator === "metal" ? "Metal" : hw.accelerator === "cuda" ? "CUDA" : "CPU"
    printBanner({
      version: pkg.version,
      model: cfg.model,
      ctxLabel: `${Math.round(effectiveContext / 1000)}k ctx`,
      accelerator: accel,
    })
  }

  const args = ["run", "--conditions=browser"]
  if (SOLID_PRELOAD) args.push("--preload", SOLID_PRELOAD)
  args.push(OPENCODE_ENTRY, ...passthrough)
  // clody: force the slim local-tuned agent for BOTH the interactive TUI
  // (no subcommand) and headless `run`, unless the user picked an agent. Without
  // this the TUI launches on opencode's heavy default "build" agent, whose large
  // system prompt + tool schemas overwhelm a local model (slow/no response).
  const sub = passthrough[0]
  if ((sub === undefined || sub === "run") && !passthrough.includes("--agent")) {
    args.push("--agent", "clody-local")
  }
  const child = Bun.spawn(["bun", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, PWD: process.cwd() },
    stdio: ["inherit", "inherit", "inherit"],
  })
  return await child.exited
}

if (import.meta.main) {
  process.exit(await main())
}
