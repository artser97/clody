import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runTask } from "../src/driver"
import type { Arm, BenchTask } from "../src/types"

const FAKE_BIN = new URL("./fake-bin.ts", import.meta.url).pathname

function makeTask(over: Partial<BenchTask> = {}): BenchTask {
  const dir = mkdtempSync(join(tmpdir(), "clody-bench-task-"))
  mkdirSync(join(dir, "files"))
  writeFileSync(join(dir, "files", "seed.txt"), "seed")
  return {
    name: "t",
    dir,
    instruction: "TOUCH the file",
    verify: "test -f touched.txt",
    timeoutMs: 30_000,
    ...over,
  }
}

const arm: Arm = { name: "judge-off", env: { CLODY_JUDGE: "0", CLODY_SKILLS: "none" } }

describe("runTask", () => {
  test("passes when the agent does the work and verify exits 0", async () => {
    const r = await runTask(makeTask(), arm, { binPath: FAKE_BIN })
    expect(r.passed).toBe(true)
    expect(r.timedOut).toBe(false)
    expect(r.wallMs).toBeGreaterThan(0)
  })

  test("fails when verify exits non-zero", async () => {
    const r = await runTask(makeTask({ verify: "test -f never-created.txt" }), arm, { binPath: FAKE_BIN })
    expect(r.passed).toBe(false)
    expect(r.timedOut).toBe(false)
  })

  test("arm env reaches the spawned bin", async () => {
    const r = await runTask(
      makeTask({ verify: `grep -q '"judge":"0"' env-seen.json && grep -q '"skills":"none"' env-seen.json` }),
      arm,
      { binPath: FAKE_BIN },
    )
    expect(r.passed).toBe(true)
  })

  test("kills and reports timeout", async () => {
    const r = await runTask(makeTask({ instruction: "SLEEP forever", timeoutMs: 1_500 }), arm, { binPath: FAKE_BIN })
    expect(r.timedOut).toBe(true)
    expect(r.passed).toBe(false)
    expect(r.wallMs).toBeLessThan(10_000)
  }, 20_000)

  test("PWD env matches the sandbox cwd (opencode trusts PWD)", async () => {
    const r = await runTask(
      makeTask({
        verify: `bun -e 'const e = await Bun.file("env-seen.json").json(); if (e.pwd_env !== e.cwd) { console.error("PWD mismatch:", e.pwd_env, "vs", e.cwd); process.exit(1) }'`,
      }),
      arm,
      { binPath: FAKE_BIN },
    )
    expect(r.passed).toBe(true)
  })
})
