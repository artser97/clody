/**
 * Interactive tool selector for `clody run`: show the tools clody exposes and
 * let the user keep all (Enter) or pick a subset by digits (e.g. "1234" =
 * read-only). Returns the CLODY_TOOLS value ("" = all tools) for the child
 * process. Fewer tools = fewer tool-schema tokens for the local model.
 */
import { createInterface } from "node:readline/promises"
import * as style from "./style"

export function parseToolSelection(input: string, tools: readonly string[]): string {
  const trimmed = input.trim().toLowerCase()
  if (trimmed === "" || trimmed === "a" || trimmed === "all") return "" // keep all tools
  const picked = [...trimmed]
    .filter((c) => /[0-9]/.test(c))
    .map((c) => tools[Number(c) - 1])
    .filter((t): t is string => t !== undefined)
  return picked.length > 0 ? picked.join(",") : "" // nothing valid picked → keep all
}

export async function confirmTools(tools: readonly string[]): Promise<string> {
  console.log("\n" + style.rule("TOOLS"))
  tools.forEach((t, i) => console.log(style.format(style.GLYPH.item, style.TEAL, `${i + 1}. ${t}`)))
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question(
      style.format(style.GLYPH.step, style.VIOLET, "Enter=all, digits=pick (e.g. 1234 = read-only): ").trimEnd() + " ",
    )
    return parseToolSelection(answer, tools)
  } finally {
    rl.close()
  }
}
