import { describe, expect, test } from "bun:test"
import { parseSkillSelection } from "../src/skills-prompt"

const suggestions = ["tdd", "review", "style"]

describe("parseSkillSelection", () => {
  test("empty input accepts all suggestions", () => {
    expect(parseSkillSelection("", suggestions)).toEqual("tdd,review,style")
  })
  test("'n' selects none", () => {
    expect(parseSkillSelection("n", suggestions)).toEqual("none")
  })
  test("digits pick by position", () => {
    expect(parseSkillSelection("13", suggestions)).toEqual("tdd,style")
    expect(parseSkillSelection("2", suggestions)).toEqual("review")
  })
  test("out-of-range digits are ignored; all-invalid means none", () => {
    expect(parseSkillSelection("9", suggestions)).toEqual("none")
    expect(parseSkillSelection("19", suggestions)).toEqual("tdd")
  })
})
