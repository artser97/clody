/**
 * Skill discovery: walk dirs for SKILL.md files (depth ≤ 3), parse name +
 * description from simple `key: value` frontmatter lines. Files without both
 * fields are skipped — a skill the router can't describe can't be routed.
 */
import { readdir, readFile, stat } from "node:fs/promises"
import { join } from "node:path"

export interface SkillInfo {
  name: string
  description: string
  bodyPath: string
}

const MAX_DEPTH = 3

async function walk(dir: string, depth: number, out: string[]): Promise<void> {
  if (depth > MAX_DEPTH) return
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return // unreadable/nonexistent dirs are skipped silently
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(full, depth + 1, out)
    } else if (entry.isSymbolicLink()) {
      // Follow symlinks: recurse if it's a directory, collect if it's SKILL.md
      try {
        const s = await stat(full)
        if (s.isDirectory()) {
          await walk(full, depth + 1, out)
        } else if (entry.name === "SKILL.md") {
          out.push(full)
        }
      } catch {
        // dangling symlink — skip silently
      }
    } else if (entry.name === "SKILL.md") {
      out.push(full)
    }
  }
}

function frontmatterField(content: string, field: string): string | undefined {
  const fm = content.match(/^---\n([\s\S]*?)\n---/)
  if (!fm) return undefined
  const lines = fm[1]!.split("\n")
  const startIdx = lines.findIndex((l) => l.startsWith(`${field}:`))
  if (startIdx === -1) return undefined
  const inline = lines[startIdx]!.slice(field.length + 1).trim()
  const continuation: string[] = []
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i]!
    if (line.trim() === "") continue
    if (!/^\s/.test(line)) break // next top-level key
    continuation.push(line.trim())
  }
  const isBlock = inline === ">" || inline === ">-" || inline === "|" || inline === "|-"
  if (isBlock) {
    const joined = continuation.join(inline.startsWith("|") ? "\n" : " ").trim()
    return joined.length > 0 ? joined : undefined
  }
  const value = [inline, ...continuation].join(" ").trim().replace(/^["']|["']$/g, "")
  return value.length > 0 ? value : undefined
}

export async function scanSkills(dirs: string[]): Promise<SkillInfo[]> {
  const files: string[] = []
  for (const dir of dirs) await walk(dir, 0, files)
  const skills: SkillInfo[] = []
  const seen = new Set<string>()
  for (const bodyPath of files) {
    let content: string
    try {
      content = await readFile(bodyPath, "utf8")
    } catch {
      continue
    }
    const name = frontmatterField(content, "name")
    const description = frontmatterField(content, "description")
    if (!name || !description || seen.has(name)) continue
    seen.add(name)
    skills.push({ name, description, bodyPath })
  }
  return skills
}
