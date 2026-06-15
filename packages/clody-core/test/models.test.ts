import { describe, expect, test } from "bun:test"
import { CURATED_MODELS, type CuratedModel } from "../src/models"

describe("CURATED_MODELS", () => {
  test("includes gemma4:12b as an intended entry", () => {
    const tags = CURATED_MODELS.map((m) => m.tag)
    expect(tags).toContain("gemma4:12b")
  })

  test("every entry is well-formed", () => {
    for (const m of CURATED_MODELS) {
      expect(m.tag).toMatch(/^[a-z0-9._-]+:[a-z0-9._-]+$/i)
      expect(m.displayName.length).toBeGreaterThan(0)
      expect(m.weightsGB).toBeGreaterThan(0)
      expect(m.kvGBPer8k).toBeGreaterThan(0)
      expect(m.contextWindow).toBeGreaterThanOrEqual(4096)
      expect(m.minRAMGB).toBeGreaterThan(0)
      expect(m.codingTier).toBeGreaterThanOrEqual(1)
      expect(m.minRAMGB).toBeGreaterThanOrEqual(m.weightsGB)
    }
  })

  test("tags are unique", () => {
    const tags = CURATED_MODELS.map((m) => m.tag)
    expect(new Set(tags).size).toBe(tags.length)
  })

  test("the top coding tier is qwen2.5:14b (strongest verified tool-reliable model)", () => {
    const top = [...CURATED_MODELS].sort((a, b) => b.codingTier - a.codingTier)[0]!
    expect(top.tag).toBe("qwen2.5:14b")
  })

  test("excludes qwen2.5-coder (its Ollama tool calls are unstructured)", () => {
    expect(CURATED_MODELS.map((m) => m.tag)).not.toContain("qwen2.5-coder:7b")
  })

  test("includes the agent-tuned native-tools coders and excludes codestral", () => {
    const tags = CURATED_MODELS.map((m) => m.tag)
    expect(tags).toContain("qwen3-coder:30b")
    expect(tags).toContain("devstral:24b")
    expect(tags).toContain("qwen3:14b")
    expect(tags).toContain("qwen3:32b")
    expect(tags).not.toContain("codestral:22b")
  })

  test("includes the qwen3.5 multimodal bench candidates without displacing the default", () => {
    const tags = CURATED_MODELS.map((m) => m.tag)
    expect(tags).toContain("qwen3.5:27b")
    expect(tags).toContain("qwen3.5:9b")
    // both below qwen2.5:14b's tier 7 so the default is unchanged
    const byTag = (t: string) => CURATED_MODELS.find((m) => m.tag === t)!
    expect(byTag("qwen3.5:27b").codingTier).toBeLessThan(byTag("qwen2.5:14b").codingTier)
    expect(byTag("qwen3.5:9b").codingTier).toBeLessThan(byTag("qwen2.5:14b").codingTier)
  })
})
