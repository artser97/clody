import { describe, expect, test } from "bun:test"
import { parseToolSelection } from "../src/tools-prompt"

const TOOLS = ["read", "grep", "glob", "list", "edit", "write", "bash"]

describe("parseToolSelection", () => {
  test("Enter (empty) keeps all tools", () => {
    expect(parseToolSelection("", TOOLS)).toBe("")
  })

  test("'all' keeps all tools", () => {
    expect(parseToolSelection("all", TOOLS)).toBe("")
  })

  test("digits pick a subset (1234 = read-only set)", () => {
    expect(parseToolSelection("1234", TOOLS)).toBe("read,grep,glob,list")
  })

  test("out-of-range / junk digits are dropped", () => {
    expect(parseToolSelection("19", TOOLS)).toBe("read") // 9 has no tool
  })

  test("no valid pick falls back to all", () => {
    expect(parseToolSelection("xyz", TOOLS)).toBe("")
  })
})
