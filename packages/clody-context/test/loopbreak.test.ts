import { describe, expect, test } from "bun:test"
import { toolCallSignature, detectToolLoop, type LoopState } from "../src/loopbreak"

describe("toolCallSignature", () => {
  test("is stable across object key order", () => {
    const a = toolCallSignature([{ tool: "edit", input: { filePath: "x", oldString: "a", newString: "b" } }])
    const b = toolCallSignature([{ tool: "edit", input: { newString: "b", filePath: "x", oldString: "a" } }])
    expect(a).toBe(b)
  })

  test("sorts nested object keys but preserves array order", () => {
    const a = toolCallSignature([{ tool: "t", input: { o: { z: 1, a: 2 }, arr: [1, 2] } }])
    const b = toolCallSignature([{ tool: "t", input: { arr: [1, 2], o: { a: 2, z: 1 } } }])
    expect(a).toBe(b)
    const c = toolCallSignature([{ tool: "t", input: { arr: [2, 1] } }])
    expect(toolCallSignature([{ tool: "t", input: { arr: [1, 2] } }])).not.toBe(c)
  })

  test("differs when tool name or args differ", () => {
    const base = toolCallSignature([{ tool: "edit", input: { a: 1 } }])
    expect(toolCallSignature([{ tool: "read", input: { a: 1 } }])).not.toBe(base)
    expect(toolCallSignature([{ tool: "edit", input: { a: 2 } }])).not.toBe(base)
  })

  test("joins multiple calls in a step", () => {
    const sig = toolCallSignature([
      { tool: "read", input: { p: "a" } },
      { tool: "edit", input: { p: "b" } },
    ])
    expect(sig).toContain("read:")
    expect(sig).toContain("edit:")
  })

  test("empty step is the empty signature", () => {
    expect(toolCallSignature([])).toBe("")
  })

  test("drops undefined-valued keys like JSON.stringify, distinct from null", () => {
    const undef = toolCallSignature([{ tool: "t", input: { a: undefined, b: 1 } }])
    const without = toolCallSignature([{ tool: "t", input: { b: 1 } }])
    const withNull = toolCallSignature([{ tool: "t", input: { a: null, b: 1 } }])
    expect(undef).toBe(without)
    expect(undef).not.toBe(withNull)
  })
})

describe("detectToolLoop", () => {
  const opts = { warnAt: 3, breakAt: 6 }

  test("empty signature resets the run", () => {
    const r = detectToolLoop({ sig: "x", count: 4 }, "", opts)
    expect(r.action).toBe("none")
    expect(r.state).toEqual({ sig: "", count: 0 })
  })

  test("a changed signature starts a new run at count 1", () => {
    const r = detectToolLoop({ sig: "old", count: 5 }, "new", opts)
    expect(r.action).toBe("none")
    expect(r.state).toEqual({ sig: "new", count: 1 })
  })

  test("first occurrence (no prev) is count 1, no action", () => {
    const r = detectToolLoop(undefined, "s", opts)
    expect(r.state).toEqual({ sig: "s", count: 1 })
    expect(r.action).toBe("none")
  })

  test("warns exactly at warnAt, only once", () => {
    let r = detectToolLoop({ sig: "s", count: 1 }, "s", opts) // count 2
    expect(r.action).toBe("none")
    r = detectToolLoop(r.state, "s", opts) // count 3
    expect(r.action).toBe("warn")
    r = detectToolLoop(r.state, "s", opts) // count 4
    expect(r.action).toBe("none")
    r = detectToolLoop(r.state, "s", opts) // count 5
    expect(r.action).toBe("none")
  })

  test("breaks at breakAt", () => {
    const r = detectToolLoop({ sig: "s", count: 5 }, "s", opts) // count 6
    expect(r.state.count).toBe(6)
    expect(r.action).toBe("break")
  })

  test("clamps warnAt below a small breakAt", () => {
    const small = { warnAt: 3, breakAt: 3 }
    const r = detectToolLoop({ sig: "s", count: 1 }, "s", small) // count 2 -> warnAt clamped to 2
    expect(r.state.count).toBe(2)
    expect(r.action).toBe("warn")
    const r2 = detectToolLoop({ sig: "s", count: 2 }, "s", small) // count 3 >= breakAt
    expect(r2.action).toBe("break")
  })
})
