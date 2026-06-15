import { describe, expect, test } from "bun:test"
import { skillBodyCacheKey } from "../src/bridge"

describe("skillBodyCacheKey", () => {
  test("is order-independent for the same set", () => {
    expect(skillBodyCacheKey(["a", "b", "c"])).toBe(skillBodyCacheKey(["c", "a", "b"]))
  })
  test("differs for different sets", () => {
    expect(skillBodyCacheKey(["a"])).not.toBe(skillBodyCacheKey(["a", "b"]))
    expect(skillBodyCacheKey([])).not.toBe(skillBodyCacheKey(["a"]))
  })
})
