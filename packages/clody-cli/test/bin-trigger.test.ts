import { describe, expect, test } from "bun:test"
import { decideEntry } from "../src/bin"

describe("decideEntry", () => {
  test("init subcommand -> full wizard", () => {
    expect(decideEntry(["init"], { configExists: true, isTTY: true })).toEqual({ kind: "wizard", modelOnly: false })
  })
  test("model subcommand -> model-only wizard", () => {
    expect(decideEntry(["model"], { configExists: true, isTTY: true })).toEqual({ kind: "wizard", modelOnly: true })
  })
  test("no config + TTY -> full wizard", () => {
    expect(decideEntry([], { configExists: false, isTTY: true })).toEqual({ kind: "wizard", modelOnly: false })
  })
  test("no config + no TTY -> fail loudly", () => {
    expect(decideEntry([], { configExists: false, isTTY: false })).toEqual({ kind: "fail-no-config" })
  })
  test("config present -> launch normally", () => {
    expect(decideEntry(["run", "fix it"], { configExists: true, isTTY: false })).toEqual({ kind: "launch" })
  })
  test("`probe` routes to the probe report, even without config", () => {
    expect(decideEntry(["probe"], { configExists: false, isTTY: false })).toEqual({ kind: "probe" })
    expect(decideEntry(["probe", "qwen3:14b"], { configExists: true, isTTY: true })).toEqual({ kind: "probe" })
  })
})
