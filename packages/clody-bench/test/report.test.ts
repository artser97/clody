import { describe, expect, test } from "bun:test"
import { renderMarkdown } from "../src/report"
import type { RunSummary } from "../src/types"

const summary: RunSummary = {
  label: "smoke",
  startedAt: "2026-06-13T10:00:00Z",
  model: "gemma4:12b",
  results: [
    { task: "alpha", arm: "judge-off", passed: true, timedOut: false, wallMs: 65000, verifyOutput: "", agentOutputTail: "" },
    { task: "alpha", arm: "judge-on", passed: true, timedOut: false, wallMs: 90000, verifyOutput: "", agentOutputTail: "" },
    { task: "beta", arm: "judge-off", passed: false, timedOut: true, wallMs: 1200000, verifyOutput: "", agentOutputTail: "" },
  ],
}

describe("renderMarkdown", () => {
  test("renders per-arm pass rates and a task matrix", () => {
    const md = renderMarkdown(summary)
    expect(md).toContain("gemma4:12b")
    expect(md).toContain("judge-off")
    expect(md).toContain("1/2")
    expect(md).toContain("1/1")
    expect(md).toContain("⏱")
    expect(md).toContain("65s")
  })
})
