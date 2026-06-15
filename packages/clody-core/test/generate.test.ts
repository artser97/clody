import { describe, expect, test } from "bun:test"
import { renderAgentMarkdown, renderProviderConfig } from "../src/generate"
import type { ProbeResult } from "../src/probe"

const probe = (over: Partial<ProbeResult> = {}): ProbeResult => ({
  streaming: true,
  toolCalling: true,
  parallelToolCalls: true,
  reasoningStyle: "none",
  latencyMs: 100,
  ...over,
})

describe("renderAgentMarkdown", () => {
  test("emits explicit allows, denies, model and temperature", () => {
    const md = renderAgentMarkdown({ model: "gemma4:12b", probe: probe() })
    expect(md).toContain("model: ollama/gemma4:12b")
    expect(md).toContain("temperature: 0.2")
    // headless "ask" silently kills turns (spike finding) — every tool explicit
    for (const tool of ["read", "edit", "write", "bash", "glob", "grep", "list"]) {
      expect(md).toContain(`${tool}: allow`)
    }
    // all-skills injection measured at ~8k chars (spike finding) — denied
    for (const tool of ["skill", "webfetch", "task", "todowrite", "todoread", "patch"]) {
      expect(md).toContain(`${tool}: deny`)
    }
  })

  test("adds anti-narration rule for reasoning models", () => {
    const md = renderAgentMarkdown({ model: "qwen3:8b", probe: probe({ reasoningStyle: "reasoning-field" }) })
    expect(md).toContain("Do not narrate")
  })

  test("adds one-call-at-a-time rule when parallel calls unsupported", () => {
    const md = renderAgentMarkdown({ model: "small:1b", probe: probe({ parallelToolCalls: false }) })
    expect(md).toContain("one tool call at a time")
  })
})

describe("renderProviderConfig", () => {
  test("emits ollama provider block with limits and default model", () => {
    const cfg = renderProviderConfig({
      model: "gemma4:12b",
      ollamaUrl: "http://localhost:11434",
      contextTokens: 32768,
      outputTokens: 8000,
    })
    expect(cfg.model).toBe("ollama/gemma4:12b")
    const ollama = cfg.provider.ollama
    expect(ollama.npm).toBe("@ai-sdk/openai-compatible")
    expect(ollama.options.baseURL).toBe("http://localhost:11434/v1")
    expect(ollama.models["gemma4:12b"].limit).toEqual({ context: 32768, output: 8000 })
  })
})
