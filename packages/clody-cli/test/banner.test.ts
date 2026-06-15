// packages/clody-cli/test/banner.test.ts
import { describe, expect, test } from "bun:test"
import { renderBanner } from "../src/banner"

describe("renderBanner", () => {
  test("includes wordmark, rule, tagline, version, and bulleted status", () => {
    const out = renderBanner(
      { version: "0.1.0", model: "qwen2.5-coder:7b", ctxLabel: "32k ctx", accelerator: "Metal" },
      false,
    )
    expect(out).toContain("██")
    expect(out).toContain("CLODY") // gradient rule
    expect(out).toContain("local-model coding agent")
    expect(out).toContain("0.1.0")
    expect(out).toContain("⬡ qwen2.5-coder:7b")
    expect(out).toContain("⬡ 32k ctx")
    expect(out).toContain("⬡ Metal")
  })

  test("no ANSI escapes when color disabled", () => {
    const out = renderBanner({ version: "0.1.0", model: "m", ctxLabel: "32k", accelerator: "CPU" }, false)
    expect(out).not.toContain("\x1b[")
  })

  test("emits truecolor escapes when color enabled", () => {
    const out = renderBanner({ version: "0.1.0", model: "m", ctxLabel: "32k", accelerator: "CPU" }, true)
    expect(out).toContain("\x1b[38;2;")
  })

  test("renders wordmark and version with no model/ctx", () => {
    const out = renderBanner({ version: "0.1.0", accelerator: "Metal" }, false)
    expect(out).toContain("██")
    expect(out).toContain("0.1.0")
    expect(out).toContain("⬡ Metal")
  })
})
