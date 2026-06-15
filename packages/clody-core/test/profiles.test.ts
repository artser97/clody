import { describe, expect, test } from "bun:test"
import { chooseNumCtx, getModelProfile, DEFAULT_PROFILE } from "../src/profiles"

describe("getModelProfile", () => {
  test("matches gemma4:12b", () => {
    const p = getModelProfile("gemma4:12b")
    expect(p.weightsGB).toBe(7.7)
    expect(p.reasoning).toBe("none")
  })
  test("falls back to default for unknown models", () => {
    expect(getModelProfile("mystery:1b")).toBe(DEFAULT_PROFILE)
  })
  test("matches qwen3.5:27b and qwen3.5:9b distinctly (escaped dot, not qwen3:*)", () => {
    expect(getModelProfile("qwen3.5:27b").weightsGB).toBe(17)
    expect(getModelProfile("qwen3.5:9b").weightsGB).toBe(6.6)
    expect(getModelProfile("qwen3.5:27b").reasoning).toBe("reasoning-field")
  })
  test("matches qwen3-coder:30b", () => {
    const p = getModelProfile("qwen3-coder:30b")
    expect(p.weightsGB).toBe(19)
    expect(p.reasoning).toBe("none")
  })
  test("matches devstral:24b", () => {
    const p = getModelProfile("devstral:24b")
    expect(p.weightsGB).toBe(14)
    expect(p.reasoning).toBe("none")
  })
  test("matches qwen3:14b distinctly from qwen3:8b", () => {
    const p = getModelProfile("qwen3:14b")
    expect(p.weightsGB).toBe(9.3)
    expect(p.reasoning).toBe("reasoning-field")
  })
  test("matches qwen3:32b", () => {
    const p = getModelProfile("qwen3:32b")
    expect(p.weightsGB).toBe(20)
    expect(p.reasoning).toBe("reasoning-field")
  })
})

describe("chooseNumCtx", () => {
  const gemma = getModelProfile("gemma4:12b") // weights 7.7GB, kv 1.0GB/8k
  test("32k fits a 24GB ceiling and is preferred when desired", () => {
    // 7.7 + 4*1.0 = 11.7GB <= 24GB
    expect(chooseNumCtx(gemma, 24, 32000)).toBe(32768)
  })
  test("prefers the smallest step satisfying desiredTokens", () => {
    expect(chooseNumCtx(gemma, 24, 8000)).toBe(8192)
  })
  test("clamps to what RAM allows", () => {
    // ceiling 9GB: 8192 needs 7.7+1.0=8.7 ✓, 16384 needs 9.7 ✗
    expect(chooseNumCtx(gemma, 9, 32000)).toBe(8192)
  })
  test("returns smallest step when nothing fits", () => {
    expect(chooseNumCtx(gemma, 4, 32000)).toBe(4096)
  })
})
