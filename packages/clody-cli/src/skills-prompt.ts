/**
 * Interactive skill confirm for `clody run`: show top-3 routed skills, let the
 * user accept (Enter), pick by digits ("13"), or decline ("n"). Returns the
 * CLODY_SKILLS value for the child process.
 */
import { createInterface } from "node:readline/promises"
import type { SkillMatch } from "@clody/context"
import * as style from "./style"

export function parseSkillSelection(input: string, names: string[]): string {
  const trimmed = input.trim().toLowerCase()
  if (trimmed === "") return names.join(",")
  if (trimmed === "n" || trimmed === "none") return "none"
  const picked = [...trimmed]
    .filter((c) => /[0-9]/.test(c))
    .map((c) => names[Number(c) - 1])
    .filter((n): n is string => n !== undefined)
  return picked.length > 0 ? picked.join(",") : "none"
}

export async function confirmSkills(matches: SkillMatch[]): Promise<string> {
  if (matches.length === 0) return "none"
  console.log("\n" + style.rule("SKILLS"))
  matches.forEach((m, i) => {
    console.log(
      style.format(
        style.GLYPH.item,
        style.TEAL,
        `${i + 1}. ${m.skill.name} (${m.score.toFixed(2)}) — ${m.skill.description.slice(0, 80)}`,
      ),
    )
  })
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question(
      style.format(style.GLYPH.step, style.VIOLET, "Enter=all, digits=pick (e.g. 13), n=none: ").trimEnd() + " ",
    )
    return parseSkillSelection(answer, matches.map((m) => m.skill.name))
  } finally {
    rl.close()
  }
}
