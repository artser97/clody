import { cp, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { BenchTask } from "./types"

/** Fresh sandbox per (task, arm): fixture files copied to a temp dir. */
export async function makeSandbox(task: BenchTask): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `clody-bench-${task.name}-`))
  await cp(join(task.dir, "files"), dir, { recursive: true })
  return dir
}
