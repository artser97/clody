import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadClodyConfig, saveProbeResult, saveClodyConfig, configFileExists } from "../src/config"

function tempConfig(contents?: object): string {
  const dir = mkdtempSync(join(tmpdir(), "clody-config-"))
  const path = join(dir, "config.json")
  if (contents) writeFileSync(path, JSON.stringify(contents))
  return path
}

describe("loadClodyConfig", () => {
  test("returns defaults when file is missing", async () => {
    const cfg = await loadClodyConfig(tempConfig())
    expect(cfg.model).toBe("gemma4:12b")
    expect(cfg.ollamaUrl).toBe("http://localhost:11434")
    expect(cfg.maxContextTokens).toBe(32000)
    expect(cfg.ramCeilingGB).toBe(24)
    expect(cfg.embeddingModel).toBe("nomic-embed-text")
    expect(cfg.probes).toEqual({})
    expect(cfg.outputTokens).toBe(8000)
    expect(cfg.skillThreshold).toBe(0.55)
    expect(cfg.judgeMode).toBe("tui")
  })

  test("merges file values over defaults", async () => {
    const path = tempConfig({ model: "qwen3:8b", ramCeilingGB: 16, outputTokens: 4000 })
    const cfg = await loadClodyConfig(path)
    expect(cfg.model).toBe("qwen3:8b")
    expect(cfg.ramCeilingGB).toBe(16)
    expect(cfg.maxContextTokens).toBe(32000)
    expect(cfg.outputTokens).toBe(4000)
  })

  test("judgeMode=off is loaded from file", async () => {
    const path = tempConfig({ judgeMode: "off" })
    const cfg = await loadClodyConfig(path)
    expect(cfg.judgeMode).toBe("off")
  })

  test("invalid judgeMode falls back to tui", async () => {
    const path = tempConfig({ judgeMode: "banana" })
    const cfg = await loadClodyConfig(path)
    expect(cfg.judgeMode).toBe("tui")
  })

  test("CLODY_MODEL env overrides file", async () => {
    process.env["CLODY_MODEL"] = "qwen3:4b"
    try {
      const cfg = await loadClodyConfig(tempConfig({ model: "gemma4:12b" }))
      expect(cfg.model).toBe("qwen3:4b")
    } finally {
      delete process.env["CLODY_MODEL"]
    }
  })
})

describe("saveProbeResult", () => {
  test("persists probe under the model key, preserving other keys", async () => {
    const path = tempConfig({ model: "gemma4:12b", custom: 42 })
    await saveProbeResult(path, "gemma4:12b", {
      streaming: true,
      toolCalling: true,
      parallelToolCalls: true,
      reasoningStyle: "none",
      latencyMs: 100,
    })
    const raw = JSON.parse(await Bun.file(path).text())
    expect(raw.custom).toBe(42)
    expect(raw.probes["gemma4:12b"].toolCalling).toBe(true)
    expect(raw.probes["gemma4:12b"].probedAt).toBeDefined()
  })
})

describe("ClodyConfig skills key", () => {
  test("defaults to an empty array when absent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clody-cfg-skills-"))
    const cfg = await loadClodyConfig(join(dir, "config.json"))
    expect(cfg.skills).toEqual([])
  })

  test("round-trips a saved skills list", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clody-cfg-skills-"))
    const path = join(dir, "config.json")
    await saveClodyConfig(path, { skills: ["write-tests", "code-review"] })
    const cfg = await loadClodyConfig(path)
    expect(cfg.skills).toEqual(["write-tests", "code-review"])
  })
})

describe("saveClodyConfig / configFileExists", () => {
  test("configFileExists is false before write, true after", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "clody-cfg-")), "config.json")
    expect(await configFileExists(path)).toBe(false)
    await saveClodyConfig(path, { model: "qwen2.5-coder:7b", ramCeilingGB: 24 })
    expect(await configFileExists(path)).toBe(true)
  })

  test("merges into existing keys without dropping probes", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "clody-cfg-")), "config.json")
    await saveClodyConfig(path, { model: "gemma4:12b", probes: { "gemma4:12b": {} as never } })
    await saveClodyConfig(path, { ramCeilingGB: 12 })
    const cfg = await loadClodyConfig(path)
    expect(cfg.model).toBe("gemma4:12b")
    expect(cfg.ramCeilingGB).toBe(12)
    expect(cfg.probes["gemma4:12b"]).toBeDefined()
  })

  test("merges probes per-model instead of replacing the whole map", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "clody-cfg-")), "config.json")
    await saveClodyConfig(path, { probes: { "model-a": { reasoningStyle: "none" } as never } })
    await saveClodyConfig(path, { probes: { "model-b": { reasoningStyle: "none" } as never } })
    const cfg = await loadClodyConfig(path)
    expect(cfg.probes["model-a"]).toBeDefined()
    expect(cfg.probes["model-b"]).toBeDefined()
  })
})
