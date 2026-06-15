// packages/clody-cli/src/skill-selector.ts
/**
 * Session-start skill selector for the clody TUI. Lists every discovered skill
 * (name + description) as a @clack/prompts multiselect so the user picks what
 * their upcoming work needs; the result becomes CLODY_SKILLS for the child.
 * toClodySkillsValue is the pure seam (unit-tested); selectSkills renders.
 */
import * as p from "@clack/prompts"
import type { SkillInfo } from "@clody/context"

/** Multiselect result -> CLODY_SKILLS value ("none" when nothing is picked). */
export function toClodySkillsValue(selected: string[]): string {
  return selected.length > 0 ? selected.join(",") : "none"
}

/**
 * Interactive session-start picker. Lists `skills` (name + description),
 * pre-ticking any whose name is in `preselected`. Returns the CLODY_SKILLS value:
 * comma-joined picked names, or "none" if nothing is ticked. Returns `null` if the
 * user cancels (Esc) — the caller keeps the prior selection rather than wiping it.
 * No skills discovered -> "none" without prompting.
 */
export async function selectSkills(skills: SkillInfo[], preselected: string[]): Promise<string | null> {
  if (skills.length === 0) return "none"
  const pre = new Set(preselected)
  const picked = await p.multiselect({
    message: "Which skills should clody load for this session? (space toggles, enter confirms)",
    options: skills.map((s) => ({
      value: s.name,
      label: s.name,
      hint: s.description.length > 80 ? s.description.slice(0, 77) + "…" : s.description,
    })),
    initialValues: skills.filter((s) => pre.has(s.name)).map((s) => s.name),
    required: false,
  })
  if (p.isCancel(picked)) return null
  return toClodySkillsValue(picked as string[])
}
