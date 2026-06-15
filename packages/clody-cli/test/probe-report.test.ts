import { describe, expect, test } from "bun:test"
import { formatProbeReport, type ProbeRow } from "../src/probe-report"

const row = (over: Partial<ProbeRow>): ProbeRow => ({
  tag: "m:1b",
  streaming: true,
  toolCalling: true,
  parallelToolCalls: true,
  reasoningStyle: "none",
  latencyMs: 1000,
  ...over,
})

describe("formatProbeReport", () => {
  test("PASS when toolCalling and no error", () => {
    const out = formatProbeReport([row({ tag: "qwen3:14b" })])
    expect(out).toContain("qwen3:14b")
    expect(out).toContain("PASS")
  })
  test("FAIL (no tool_calls) when toolCalling is false", () => {
    const out = formatProbeReport([row({ toolCalling: false })])
    expect(out).toContain("FAIL (no tool_calls)")
  })
  test("FAIL with the error string when present", () => {
    const out = formatProbeReport([row({ error: "pull failed" })])
    expect(out).toContain("FAIL (pull failed)")
  })
  test("renders a header line plus one line per row", () => {
    const out = formatProbeReport([row({ tag: "a:1" }), row({ tag: "b:1" })])
    const lines = out.split("\n")
    expect(lines.length).toBe(3) // header + 2 rows
    expect(lines[0]).toContain("tools")
  })
})
