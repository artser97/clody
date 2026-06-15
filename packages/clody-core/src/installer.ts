// packages/clody-core/src/installer.ts
/**
 * Ollama install planning (confirm-then-run is the caller's job) and model
 * pulling with progress. planOllamaInstall and parsePullProgress are pure;
 * runInstall and pullModel perform IO.
 */
import { spawn } from "node:child_process"

export interface InstallPlan {
  cmd: string[]
  human: string
}

export function planOllamaInstall(platform: NodeJS.Platform): InstallPlan | null {
  if (platform === "darwin") {
    return { cmd: ["brew", "install", "ollama"], human: "brew install ollama" }
  }
  if (platform === "linux") {
    const human = "curl -fsSL https://ollama.com/install.sh | sh"
    return { cmd: ["sh", "-c", human], human }
  }
  return null
}

/** Runs an install plan, streaming child output to onLine. Resolves to exit code. */
export function runInstall(plan: InstallPlan, onLine: (line: string) => void): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(plan.cmd[0]!, plan.cmd.slice(1), { stdio: ["ignore", "pipe", "pipe"] })
    const pipe = (chunk: Buffer): void => chunk.toString().split("\n").filter(Boolean).forEach(onLine)
    child.stdout?.on("data", pipe)
    child.stderr?.on("data", pipe)
    child.on("error", () => resolve(1))
    child.on("close", (code) => resolve(code ?? 1))
  })
}

export interface PullProgress {
  status: string
  total: number | null
  completed: number | null
  /** completed/total in [0,1], or null when totals are absent. */
  fraction: number | null
}

export function parsePullProgress(line: string): PullProgress | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  let obj: { status?: string; total?: number; completed?: number }
  try {
    obj = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (typeof obj.status !== "string") return null
  const total = typeof obj.total === "number" ? obj.total : null
  const completed = typeof obj.completed === "number" ? obj.completed : null
  const fraction = total && completed !== null ? Math.min(completed / total, 1) : null
  return { status: obj.status, total, completed, fraction }
}

/** Streams `ollama pull <tag>` via the HTTP API, calling onProgress per line. */
export async function pullModel(
  ollamaUrl: string,
  tag: string,
  onProgress: (p: PullProgress) => void,
): Promise<boolean> {
  const res = await fetch(`${ollamaUrl}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: tag, stream: true }),
  })
  if (!res.ok || !res.body) return false
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let pending = ""
  let lastStatus = ""
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      pending += decoder.decode(value, { stream: true })
      const lines = pending.split("\n")
      pending = lines.pop() ?? ""
      for (const line of lines) {
        const p = parsePullProgress(line)
        if (p) {
          lastStatus = p.status
          onProgress(p)
        }
      }
    }
    if (pending) {
      const p = parsePullProgress(pending)
      if (p) {
        lastStatus = p.status
        onProgress(p)
      }
    }
  } finally {
    reader.releaseLock()
  }
  return !/error/i.test(lastStatus)
}
