// packages/clody-cli/src/probe-report.ts
/**
 * Pure formatter for `clody probe`: turns probe results into an aligned table.
 * The `tools` column (and verdict) is the headline — it's what separates a usable
 * agent model from a text-only one. No ANSI/IO here; the caller adds color.
 */
import type { ProbeResult } from "@clody/core"

export interface ProbeRow {
  tag: string
  streaming: boolean
  toolCalling: boolean
  parallelToolCalls: boolean
  reasoningStyle: string
  latencyMs: number
  error?: string
}

/** Map a live ProbeResult to a row. */
export function toProbeRow(tag: string, r: ProbeResult): ProbeRow {
  return {
    tag,
    streaming: r.streaming,
    toolCalling: r.toolCalling,
    parallelToolCalls: r.parallelToolCalls,
    reasoningStyle: r.reasoningStyle,
    latencyMs: r.latencyMs,
    error: r.error,
  }
}

function verdict(r: ProbeRow): string {
  if (r.error) return `FAIL (${r.error})`
  return r.toolCalling ? "PASS" : "FAIL (no tool_calls)"
}

const HEADER = ["tag", "stream", "tools", "parallel", "reasoning", "latency", "verdict"]

export function formatProbeReport(rows: ProbeRow[]): string {
  const yn = (b: boolean): string => (b ? "yes" : "no")
  const body = rows.map((r) => [
    r.tag,
    yn(r.streaming),
    yn(r.toolCalling),
    yn(r.parallelToolCalls),
    r.reasoningStyle,
    `${(r.latencyMs / 1000).toFixed(1)}s`,
    verdict(r),
  ])
  const widths = HEADER.map((h, i) => Math.max(h.length, ...body.map((cells) => cells[i]!.length)))
  const fmt = (cells: string[]): string => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd()
  return [fmt(HEADER), ...body.map(fmt)].join("\n")
}
