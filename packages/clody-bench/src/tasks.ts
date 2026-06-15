import { readdir } from "node:fs/promises"
import { join } from "node:path"
import type { BenchTask } from "./types"

/** Local 12B reality: warm palindrome ran ~711s in Phase A. */
export const DEFAULT_TIMEOUT_MS = 1_200_000

export async function loadTasks(fixturesDir: string): Promise<BenchTask[]> {
  const entries = await readdir(fixturesDir, { withFileTypes: true })
  const tasks: BenchTask[] = []
  for (const entry of entries.filter((e) => e.isDirectory()).toSorted((a, b) => a.name.localeCompare(b.name))) {
    const dir = join(fixturesDir, entry.name)
    let raw: { instruction?: string; verify?: string; timeoutMs?: number }
    try {
      raw = (await Bun.file(join(dir, "task.json")).json()) as typeof raw
    } catch {
      continue
    }
    if (!raw.instruction || !raw.verify) continue
    tasks.push({
      name: entry.name,
      dir,
      instruction: raw.instruction,
      verify: raw.verify,
      timeoutMs: raw.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    })
  }
  return tasks
}
