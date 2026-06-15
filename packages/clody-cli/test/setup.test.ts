import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { writeOpencodeSetup } from "../src/setup"

describe("writeOpencodeSetup", () => {
  test("writes agent markdown and merges provider block into opencode.json", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "clody-oc-"))
    // pre-existing user config that must survive the merge
    await Bun.write(join(configDir, "opencode.json"), JSON.stringify({ theme: "dark" }))

    await writeOpencodeSetup({
      configDir,
      model: "gemma4:12b",
      ollamaUrl: "http://localhost:11434",
      contextTokens: 32768,
      outputTokens: 8000,
      probe: {
        streaming: true,
        toolCalling: true,
        parallelToolCalls: true,
        reasoningStyle: "none",
        latencyMs: 1,
      },
    })

    const agent = await Bun.file(join(configDir, "agents", "clody-local.md")).text()
    expect(agent).toContain("model: ollama/gemma4:12b")

    const cfg = JSON.parse(await Bun.file(join(configDir, "opencode.json")).text())
    expect(cfg.theme).toBe("dark") // merge preserved user keys
    expect(cfg.model).toBe("ollama/gemma4:12b")
    expect(cfg.provider.ollama.models["gemma4:12b"].limit.context).toBe(32768)
  })

  test("creates tui.json defaulting theme to clody when none exists", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "clody-tui-"))
    await writeOpencodeSetup({
      configDir,
      model: "gemma4:12b",
      ollamaUrl: "http://localhost:11434",
      contextTokens: 32768,
      outputTokens: 8000,
      probe: { streaming: true, toolCalling: true, parallelToolCalls: true, reasoningStyle: "none", latencyMs: 1 },
    })
    const tui = JSON.parse(await Bun.file(join(configDir, "tui.json")).text())
    expect(tui.theme).toBe("clody")
    expect(tui["$schema"]).toBe("https://opencode.ai/tui.json")
  })

  test("preserves a user's explicit tui.json theme", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "clody-tui-"))
    await Bun.write(join(configDir, "tui.json"), JSON.stringify({ theme: "dracula", keybinds: { leader: "," } }))
    await writeOpencodeSetup({
      configDir,
      model: "gemma4:12b",
      ollamaUrl: "http://localhost:11434",
      contextTokens: 32768,
      outputTokens: 8000,
      probe: { streaming: true, toolCalling: true, parallelToolCalls: true, reasoningStyle: "none", latencyMs: 1 },
    })
    const tui = JSON.parse(await Bun.file(join(configDir, "tui.json")).text())
    expect(tui.theme).toBe("dracula")
    expect(tui.keybinds.leader).toBe(",")
  })
})
