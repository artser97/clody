import { describe, expect, test } from "bun:test"
import { paint, gradient, format, rule, bar, bold, dim, GLYPH, VIOLET, SUCCESS, lerpColor } from "../src/style"

describe("paint", () => {
  test("emits a truecolor escape when color is on", () => {
    expect(paint(VIOLET, "x", true)).toBe("\x1b[38;2;150;90;255mx\x1b[0m")
  })
  test("returns plain text when color is off", () => {
    expect(paint(VIOLET, "x", false)).toBe("x")
  })
})

describe("gradient", () => {
  test("emits truecolor escapes when color is on", () => {
    const out = gradient("ab", true)
    expect(out).toContain("\x1b[38;2;")
    expect(out).toContain("\x1b[0m")
  })
  test("no ANSI when color is off", () => {
    expect(gradient("hello", false)).toBe("hello")
  })
})

describe("format", () => {
  test("indents two spaces and prefixes the painted glyph (color off)", () => {
    expect(format(GLYPH.ok, SUCCESS, "ready", false)).toBe("  ✔ ready")
  })
  test("paints the glyph when color is on but leaves the message uncolored", () => {
    const out = format(GLYPH.ok, SUCCESS, "ready", true)
    expect(out).toContain("\x1b[38;2;43;224;166m✔\x1b[0m")
    expect(out).toContain(" ready")
  })
})

describe("rule", () => {
  test("contains the title and is plain when color off", () => {
    const out = rule("CLODY", false)
    expect(out).toContain("CLODY")
    expect(out).not.toContain("\x1b[")
  })
  test("pads to a fixed width with box-drawing dashes", () => {
    const out = rule("CLODY", false)
    // "▰▱ CLODY " is 9 chars; padded to width 44 => 35 dashes
    expect([...out].length).toBe(44)
    expect(out.endsWith("─")).toBe(true)
  })
})

describe("bold", () => {
  test("wraps in bold ANSI when color on, plain when off", () => {
    expect(bold("x", true)).toBe("\x1b[1mx\x1b[0m")
    expect(bold("x", false)).toBe("x")
  })
})

describe("dim", () => {
  test("wraps in dim ANSI when color on, plain when off", () => {
    expect(dim("x", true)).toBe("\x1b[2mx\x1b[0m")
    expect(dim("x", false)).toBe("x")
  })
})

describe("bar", () => {
  test("fills proportionally and clamps (color off)", () => {
    expect(bar(0.5, 10, false)).toBe("█████░░░░░")
    expect(bar(2, 4, false)).toBe("████")
    expect(bar(-1, 4, false)).toBe("░░░░")
  })
})

describe("lerpColor", () => {
  test("returns endpoints at t=0 and t=1, midpoint at t=0.5", () => {
    expect(lerpColor(VIOLET, SUCCESS, 0)).toEqual([150, 90, 255])
    expect(lerpColor(VIOLET, SUCCESS, 1)).toEqual([43, 224, 166])
    expect(lerpColor([0, 0, 0], [10, 20, 30], 0.5)).toEqual([5, 10, 15])
  })
})
