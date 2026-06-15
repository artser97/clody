export interface BenchTask {
  name: string
  dir: string // absolute fixture dir (contains task.json + files/)
  instruction: string
  verify: string
  timeoutMs: number
}

export interface Arm {
  name: string // e.g. "judge-off"
  env: Record<string, string> // merged over base env
}

export interface TaskResult {
  task: string
  arm: string
  passed: boolean
  timedOut: boolean
  wallMs: number
  verifyOutput: string
  agentOutputTail: string
  error?: string
}

export interface RunSummary {
  label: string
  startedAt: string
  model: string
  results: TaskResult[]
}
