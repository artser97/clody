/**
 * Ollama lifecycle, ported from clody v1: start the daemon with the right
 * OLLAMA_CONTEXT_LENGTH, wait for readiness, warm the chat model.
 * Settings come from the caller — this module reads no config.
 */
import { spawn } from "node:child_process"

const OLLAMA_STARTUP_TIMEOUT_MS = 20_000
const MODEL_WARMUP_TIMEOUT_MS = 180_000

export interface EnsureOllamaOptions {
  model: string
  ollamaUrl: string
  contextLength: number
  log?: (line: string) => void
}

export async function isOllamaRunning(ollamaUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2000) })
    return response.ok
  } catch {
    return false
  }
}

async function waitUntilOllamaReady(ollamaUrl: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isOllamaRunning(ollamaUrl)) return true
    await new Promise<void>((resolve) => setTimeout(resolve, 500))
  }
  return false
}

function namesMatch(loaded: string, wanted: string): boolean {
  if (loaded === wanted) return true
  // Ollama reports bare pulls as ":latest"
  return !wanted.includes(":") && loaded === `${wanted}:latest`
}

export async function isModelLoaded(ollamaUrl: string, model: string): Promise<boolean> {
  try {
    const response = await fetch(`${ollamaUrl}/api/ps`, { signal: AbortSignal.timeout(2000) })
    if (!response.ok) return false
    const data = (await response.json()) as { models?: Array<{ name: string }> }
    return (data.models ?? []).some((m) => namesMatch(m.name, model))
  } catch {
    return false
  }
}

/** Context length Ollama actually loaded the model with, or null if unknown. */
export async function readLoadedContextLength(ollamaUrl: string, model: string): Promise<number | null> {
  try {
    const response = await fetch(`${ollamaUrl}/api/ps`, { signal: AbortSignal.timeout(2000) })
    if (!response.ok) return null
    const data = (await response.json()) as { models?: Array<{ name: string; context_length?: number }> }
    const loaded = (data.models ?? []).find((m) => namesMatch(m.name, model))
    return loaded?.context_length ?? null
  } catch {
    return null
  }
}

async function warmupModel(ollamaUrl: string, model: string, log: (line: string) => void): Promise<void> {
  log(`[clody] Loading ${model}...`)
  try {
    const res = await fetch(`${ollamaUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }], max_tokens: 1, stream: true }),
      signal: AbortSignal.timeout(MODEL_WARMUP_TIMEOUT_MS),
    })
    if (res.body) {
      for await (const _ of res.body) {
        /* drain */
      }
    }
    log(`[clody] ${model} ready.`)
  } catch {
    log(`[clody] ${model} load timed out, will serve anyway.`)
  }
}

/** Returns false only when Ollama could not be started at all. */
export async function ensureOllama(opts: EnsureOllamaOptions): Promise<boolean> {
  const log = opts.log ?? console.log

  if (await isOllamaRunning(opts.ollamaUrl)) {
    log(
      `[clody] Using already-running Ollama — its context length may be the 4096 default. ` +
        `For the configured ${opts.contextLength}, stop it and let clody start it.`,
    )
    if (!(await isModelLoaded(opts.ollamaUrl, opts.model))) {
      await warmupModel(opts.ollamaUrl, opts.model, log)
    }
    return true
  }

  log("[clody] Starting Ollama...")
  const child = spawn("ollama", ["serve"], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, OLLAMA_CONTEXT_LENGTH: String(opts.contextLength) },
  })
  let spawnFailed = false
  child.on("error", () => {
    spawnFailed = true
  })
  child.unref()
  // Give the error event one tick to fire for a missing binary
  await new Promise<void>((resolve) => setTimeout(resolve, 50))
  if (spawnFailed) {
    log("[clody] Ollama binary not found. Install it: brew install ollama")
    return false
  }

  const ready = await waitUntilOllamaReady(opts.ollamaUrl, OLLAMA_STARTUP_TIMEOUT_MS)
  if (!ready) {
    log("[clody] Ollama failed to start within 20s. Is it installed? Run: brew install ollama")
    return false
  }
  log("[clody] Ollama ready.")
  await warmupModel(opts.ollamaUrl, opts.model, log)
  return true
}
