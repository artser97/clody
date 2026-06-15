import { realpathSync } from "node:fs"
import { join } from "node:path"
import { makeSandbox } from "./sandbox"
import type { Arm, BenchTask, TaskResult } from "./types"

const VERIFY_TIMEOUT_MS = 60_000
const DEFAULT_BIN = join(import.meta.dir, "..", "..", "clody-cli", "src", "bin.ts")

export interface DriverOptions {
  binPath?: string
}

async function runWithTimeout(
  cmd: string[],
  cwd: string,
  env: Record<string, string | undefined>,
  timeoutMs: number,
): Promise<{ exitCode: number | null; output: string; timedOut: boolean }> {
  const proc = Bun.spawn(cmd, { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    proc.kill(9)
  }, timeoutMs)
  const [exitCode, out, err] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  clearTimeout(timer)
  return { exitCode: timedOut ? null : exitCode, output: out + err, timedOut }
}

export async function runTask(task: BenchTask, arm: Arm, opts: DriverOptions = {}): Promise<TaskResult> {
  const sandbox = realpathSync(await makeSandbox(task))
  const start = Date.now()
  const agent = await runWithTimeout(
    ["bun", opts.binPath ?? DEFAULT_BIN, "run", task.instruction],
    sandbox,
    { ...arm.env, PWD: sandbox, INIT_CWD: sandbox },
    task.timeoutMs,
  )
  const wallMs = Date.now() - start
  if (agent.timedOut) {
    return {
      task: task.name,
      arm: arm.name,
      passed: false,
      timedOut: true,
      wallMs,
      verifyOutput: "",
      agentOutputTail: agent.output.slice(-500),
    }
  }
  const verify = await runWithTimeout(["sh", "-c", task.verify], sandbox, { PWD: sandbox }, VERIFY_TIMEOUT_MS)
  return {
    task: task.name,
    arm: arm.name,
    passed: !verify.timedOut && verify.exitCode === 0,
    timedOut: false,
    wallMs,
    verifyOutput: verify.output.slice(-500),
    agentOutputTail: agent.output.slice(-500),
  }
}
