// packages/clody-core/test/installer.test.ts
import { describe, expect, test } from "bun:test"
import { planOllamaInstall, parsePullProgress } from "../src/installer"

describe("planOllamaInstall", () => {
  test("darwin -> brew", () => {
    const p = planOllamaInstall("darwin")
    expect(p).not.toBeNull()
    expect(p!.cmd).toEqual(["brew", "install", "ollama"])
    expect(p!.human).toContain("brew install ollama")
  })
  test("linux -> official curl script", () => {
    const p = planOllamaInstall("linux")
    expect(p).not.toBeNull()
    expect(p!.cmd[0]).toBe("sh")
    expect(p!.human).toContain("ollama.com/install.sh")
  })
  test("win32 -> null (manual)", () => {
    expect(planOllamaInstall("win32")).toBeNull()
  })
})

describe("parsePullProgress", () => {
  test("parses a progress line with totals", () => {
    const line = JSON.stringify({ status: "pulling abc", total: 4700000000, completed: 2350000000 })
    const p = parsePullProgress(line)
    expect(p).not.toBeNull()
    expect(p!.status).toBe("pulling abc")
    expect(p!.fraction).toBeCloseTo(0.5, 2)
  })
  test("parses a status-only line (no totals)", () => {
    const p = parsePullProgress(JSON.stringify({ status: "verifying sha256 digest" }))
    expect(p).not.toBeNull()
    expect(p!.fraction).toBeNull()
  })
  test("returns null on blank or non-JSON", () => {
    expect(parsePullProgress("")).toBeNull()
    expect(parsePullProgress("not json")).toBeNull()
  })
})
