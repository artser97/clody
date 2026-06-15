import { describe, expect, test } from "bun:test"
import { toClodySkillsValue } from "../src/skill-selector"

describe("toClodySkillsValue", () => {
  test("empty selection -> none", () => {
    expect(toClodySkillsValue([])).toBe("none")
  })
  test("single skill", () => {
    expect(toClodySkillsValue(["write-tests"])).toBe("write-tests")
  })
  test("multiple skills are comma-joined, order preserved", () => {
    expect(toClodySkillsValue(["b", "a", "c"])).toBe("b,a,c")
  })
})
