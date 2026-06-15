// packages/clody-core/test/recommend.test.ts
import { describe, expect, test } from "bun:test"
import { recommendModels } from "../src/recommend"
import type { Hardware } from "../src/hardware"

const mac32: Hardware = { ramGB: 32, cores: 10, accelerator: "metal", unifiedMemory: true }
const small8: Hardware = { ramGB: 8, cores: 4, accelerator: "cpu", unifiedMemory: false }
const mid10: Hardware = { ramGB: 10, cores: 8, accelerator: "cpu", unifiedMemory: false }

describe("recommendModels", () => {
  test("32GB: a fitting model is the default and it is not too-big", () => {
    const ranked = recommendModels(mac32)
    const def = ranked.find((r) => r.isDefault)
    expect(def).toBeDefined()
    expect(def!.verdict).not.toBe("too-big")
  })

  test("32GB: qwen3:32b is offered but never the default (slow, tier 6 < qwen2.5:14b)", () => {
    const ranked = recommendModels(mac32)
    const big = ranked.find((r) => r.model.tag === "qwen3:32b")
    expect(big).toBeDefined()
    expect(big!.isDefault).toBe(false)
  })

  test("8GB: never defaults to a model needing more RAM", () => {
    const ranked = recommendModels(small8)
    const def = ranked.find((r) => r.isDefault)
    if (def) expect(def.model.minRAMGB).toBeLessThanOrEqual(8)
    const big = ranked.find((r) => r.model.tag === "qwen3:32b")
    expect(big!.verdict).toBe("too-big")
  })

  test("ranking puts comfy before ok before too-big", () => {
    const ranked = recommendModels(mac32)
    const order = { comfy: 0, ok: 1, "too-big": 2 } as const
    for (let i = 1; i < ranked.length; i++) {
      expect(order[ranked[i]!.verdict]).toBeGreaterThanOrEqual(order[ranked[i - 1]!.verdict])
    }
  })

  test("every curated model appears exactly once", () => {
    const ranked = recommendModels(mac32)
    expect(ranked.length).toBe(new Set(ranked.map((r) => r.model.tag)).size)
  })

  test("10GB: no model is comfy, default falls through to an ok model", () => {
    const ranked = recommendModels(mid10)
    expect(ranked.some((r) => r.verdict === "comfy")).toBe(false)
    expect(ranked.some((r) => r.verdict === "ok")).toBe(true)
    const def = ranked.find((r) => r.isDefault)
    expect(def).toBeDefined()
    expect(def!.verdict).toBe("ok")
  })
})
