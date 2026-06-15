#!/usr/bin/env bun
/**
 * clody bench runner. Sequential by design — one local model.
 *   bun run bench -- --tasks add-palindrome,fix-missing-await --arms judge-off,judge-on
 *   bun run bench -- --tasks all --arms judge-off --label nightly
 * Arms: judge-off | judge-on | skills-auto | context-off (combinable via comma).
 * Output: bench/results/<label>-<timestamp>.{json,md}
 */
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { loadTasks } from "./tasks"
import { runTask } from "./driver"
import { renderMarkdown } from "./report"
import type { Arm, RunSummary } from "./types"

const ARMS: Record<string, Arm> = {
  "judge-off": { name: "judge-off", env: { CLODY_JUDGE: "0", CLODY_SKILLS: "none" } },
  "judge-on": { name: "judge-on", env: { CLODY_JUDGE: "1", CLODY_SKILLS: "none" } },
  "skills-auto": { name: "skills-auto", env: { CLODY_JUDGE: "0" } },
  "context-off": { name: "context-off", env: { CLODY_JUDGE: "0", CLODY_SKILLS: "none", CLODY_CONTEXT: "0" } },
}

function argValue(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback
}

const repoRoot = join(import.meta.dir, "..", "..", "..")
const tasksArg = argValue("--tasks", "all")
const armsArg = argValue("--arms", "judge-off")
const label = argValue("--label", "run")

const allTasks = await loadTasks(join(repoRoot, "bench", "tasks"))
const tasks = tasksArg === "all" ? allTasks : allTasks.filter((t) => tasksArg.split(",").includes(t.name))
const arms = armsArg.split(",").map((a) => {
  const arm = ARMS[a]
  if (!arm) throw new Error(`unknown arm "${a}" — known: ${Object.keys(ARMS).join(", ")}`)
  return arm
})
if (tasks.length === 0) throw new Error(`no tasks matched "${tasksArg}"`)

const summary: RunSummary = {
  label,
  startedAt: new Date().toISOString(),
  model: process.env["CLODY_MODEL"] ?? "gemma4:12b",
  results: [],
}

console.log(`[bench] ${tasks.length} task(s) × ${arms.length} arm(s), sequential`)
for (const arm of arms) {
  for (const task of tasks) {
    process.stdout.write(`[bench] ${arm.name}/${task.name} ... `)
    const r = await runTask(task, arm)
    summary.results.push(r)
    console.log(r.timedOut ? `TIMEOUT ${Math.round(r.wallMs / 1000)}s` : `${r.passed ? "PASS" : "FAIL"} ${Math.round(r.wallMs / 1000)}s`)
  }
}

const outDir = join(repoRoot, "bench", "results")
await mkdir(outDir, { recursive: true })
const stamp = summary.startedAt.replace(/[:.]/g, "-")
await Bun.write(join(outDir, `${label}-${stamp}.json`), JSON.stringify(summary, null, 2))
const md = renderMarkdown(summary)
await Bun.write(join(outDir, `${label}-${stamp}.md`), md)
console.log(md)
console.log(`[bench] wrote bench/results/${label}-${stamp}.{json,md}`)
