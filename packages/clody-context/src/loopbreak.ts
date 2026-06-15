// packages/clody-context/src/loopbreak.ts
/**
 * Loop-breaker: detect a run of identical consecutive tool calls so the harness
 * can stop a local model that keeps re-issuing the same failing/no-op action.
 * Pure + unit-tested; the prompt.ts hook supplies each step's tool calls and
 * performs the IO (corrective reminder / break).
 */
export interface LoopState {
  sig: string
  count: number
}

export interface LoopOptions {
  warnAt: number
  breakAt: number
}

export type LoopAction = "none" | "warn" | "break"

export interface ToolCall {
  tool: string
  input: unknown
}

/**
 * Deterministic JSON: object keys sorted recursively; array order preserved.
 * Assumes plain JSON-decoded values (tool-call inputs); mirrors JSON.stringify
 * by dropping object keys whose value is `undefined`.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]"
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}"
}

/** Signature for one step's tool calls. Empty array -> "" (a non-tool step). */
export function toolCallSignature(calls: ReadonlyArray<ToolCall>): string {
  return calls.map((c) => c.tool + ":" + stableStringify(c.input)).join(" ")
}

/**
 * Advance per-session loop state with this step's signature.
 * - empty signature        -> reset, "none"
 * - changed/new signature  -> new run (count 1), "none"
 * - repeated signature     -> count++, "warn" exactly at warnAt, "break" at >= breakAt
 * warnAt is clamped to [1, breakAt - 1] so it always fires before break.
 */
export function detectToolLoop(
  prev: LoopState | undefined,
  stepSignature: string,
  opts: LoopOptions,
): { state: LoopState; action: LoopAction } {
  if (stepSignature === "") return { state: { sig: "", count: 0 }, action: "none" }
  if (!prev || prev.sig !== stepSignature) {
    return { state: { sig: stepSignature, count: 1 }, action: "none" }
  }
  const count = prev.count + 1
  const state: LoopState = { sig: stepSignature, count }
  if (count >= opts.breakAt) return { state, action: "break" }
  const warnAt = Math.max(1, Math.min(opts.warnAt, opts.breakAt - 1))
  if (count === warnAt) return { state, action: "warn" }
  return { state, action: "none" }
}
