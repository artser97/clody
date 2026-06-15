import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadTasks, DEFAULT_TIMEOUT_MS } from "../src/tasks"

function fixtures(): string {
  const root = mkdtempSync(join(tmpdir(), "clody-bench-fix-"))
  mkdirSync(join(root, "alpha", "files"), { recursive: true })
  writeFileSync(join(root, "alpha", "task.json"), JSON.stringify({ instruction: "do alpha", verify: "node --test" }))
  writeFileSync(join(root, "alpha", "files", "a.mjs"), "export {}\n")
  mkdirSync(join(root, "beta", "files"), { recursive: true })
  writeFileSync(
    join(root, "beta", "task.json"),
    JSON.stringify({ instruction: "do beta", verify: "node verify.mjs", timeoutMs: 60000 }),
  )
  mkdirSync(join(root, "junk"))
  return root
}

describe("loadTasks", () => {
  test("loads tasks sorted by name with defaults, skips dirs without task.json", async () => {
    const tasks = await loadTasks(fixtures())
    expect(tasks.map((t) => t.name)).toEqual(["alpha", "beta"])
    expect(tasks[0]!.instruction).toBe("do alpha")
    expect(tasks[0]!.timeoutMs).toBe(DEFAULT_TIMEOUT_MS)
    expect(tasks[1]!.timeoutMs).toBe(60000)
    expect(tasks[0]!.dir.endsWith("alpha")).toBe(true)
  })

  test("loads the real fixture set (15 tasks)", async () => {
    const tasks = await loadTasks("/Users/artsiomsiarebranikau/clody-v2/bench/tasks")
    expect(tasks).toHaveLength(15)
    expect(tasks.every((t) => t.instruction.length > 0 && t.verify.length > 0)).toBe(true)
  })
})
