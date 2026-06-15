import { afterEach, describe, expect, test } from "bun:test"
import { selectActiveTools } from "../src/bridge"

const ALL = ["read", "edit", "write", "bash", "glob", "grep", "list"]

afterEach(() => {
  delete process.env["CLODY_TOOLS"]
})

describe("selectActiveTools", () => {
  test("unset CLODY_TOOLS => all tools (no-op)", () => {
    delete process.env["CLODY_TOOLS"]
    expect(selectActiveTools(ALL)).toEqual(ALL)
  })

  test("restricts to the listed tools, preserving available order", () => {
    process.env["CLODY_TOOLS"] = "read,grep,glob,list"
    expect(selectActiveTools(ALL)).toEqual(["read", "glob", "grep", "list"])
  })

  test("ignores unknown tool names", () => {
    process.env["CLODY_TOOLS"] = "read,does-not-exist,bash"
    expect(selectActiveTools(ALL)).toEqual(["read", "bash"])
  })

  test("never strands the agent: empty selection falls back to all", () => {
    process.env["CLODY_TOOLS"] = "nonexistent1,nonexistent2"
    expect(selectActiveTools(ALL)).toEqual(ALL)
  })

  test("blank CLODY_TOOLS => all tools", () => {
    process.env["CLODY_TOOLS"] = "  "
    expect(selectActiveTools(ALL)).toEqual(ALL)
  })
})
