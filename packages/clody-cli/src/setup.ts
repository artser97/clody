/**
 * Writes the generated opencode config: agents/clody-local.md, a read-merge-write
 * of opencode.json (user keys preserved, clody keys win), and tui.json defaulting
 * the theme to clody (only when the user has not chosen one).
 */
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { renderAgentMarkdown, renderProviderConfig, type ProbeResult } from "@clody/core"

export interface SetupInput {
  configDir: string // e.g. ~/.config/opencode
  model: string
  ollamaUrl: string
  contextTokens: number
  outputTokens: number
  probe: ProbeResult
}

export async function writeOpencodeSetup(input: SetupInput): Promise<void> {
  const agentsDir = join(input.configDir, "agents")
  await mkdir(agentsDir, { recursive: true })
  await Bun.write(
    join(agentsDir, "clody-local.md"),
    renderAgentMarkdown({ model: input.model, probe: input.probe }),
  )

  const configPath = join(input.configDir, "opencode.json")
  let existing: Record<string, unknown> = {}
  try {
    existing = (await Bun.file(configPath).json()) as Record<string, unknown>
  } catch {
    /* no existing config */
  }
  const generated = renderProviderConfig({
    model: input.model,
    ollamaUrl: input.ollamaUrl,
    contextTokens: input.contextTokens,
    outputTokens: input.outputTokens,
  })
  const merged = {
    ...existing,
    model: generated.model,
    provider: { ...(existing["provider"] as object | undefined), ...generated.provider },
  }
  await Bun.write(configPath, JSON.stringify(merged, null, 2))

  // clody: default the TUI theme. opencode migrates `theme` out of opencode.json
  // into tui.json, so write it there. Only set it when the user has no explicit
  // theme — never clobber a deliberate pick. Read is fail-soft like opencode.json.
  const tuiPath = join(input.configDir, "tui.json")
  let tui: Record<string, unknown> = {}
  try {
    tui = (await Bun.file(tuiPath).json()) as Record<string, unknown>
  } catch {
    /* no existing tui.json */
  }
  if (!("theme" in tui)) {
    tui["$schema"] = tui["$schema"] ?? "https://opencode.ai/tui.json"
    tui["theme"] = "clody"
    await Bun.write(tuiPath, JSON.stringify(tui, null, 2))
  }
}
