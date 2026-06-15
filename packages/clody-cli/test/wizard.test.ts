// packages/clody-cli/test/wizard.test.ts
import { describe, expect, test } from "bun:test"
import { planSetup } from "../src/wizard"
import type { Hardware } from "@clody/core"

const mac32: Hardware = { ramGB: 32, cores: 10, accelerator: "metal", unifiedMemory: true }

describe("planSetup", () => {
  test("probe without tool-calling -> reprompt, no config", () => {
    const r = planSetup({
      hardware: mac32,
      model: "qwen2.5-coder:7b",
      probe: { streaming: true, toolCalling: false, parallelToolCalls: false, reasoningStyle: "none", latencyMs: 1 },
    })
    expect(r.action).toBe("reprompt")
  })

  test("good probe -> write config with derived ceiling and chosen model", () => {
    const r = planSetup({
      hardware: mac32,
      model: "qwen2.5-coder:7b",
      probe: { streaming: true, toolCalling: true, parallelToolCalls: true, reasoningStyle: "none", latencyMs: 1 },
    })
    expect(r.action).toBe("write")
    if (r.action === "write") {
      expect(r.config.model).toBe("qwen2.5-coder:7b")
      expect(r.config.ramCeilingGB).toBe(24)
    }
  })
})
