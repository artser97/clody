/**
 * Live capability probe: three short streaming calls measuring what a model
 * actually does on THIS machine — never assume tool calling from a blog post.
 * Used by `clody setup`; results persist in config and override profile
 * defaults (reasoning style) in the gateway.
 */
import type { ReasoningStyle } from "./profiles"

export interface ProbeResult {
  streaming: boolean
  toolCalling: boolean
  parallelToolCalls: boolean
  reasoningStyle: ReasoningStyle
  latencyMs: number
  error?: string
}

interface ProbeChunk {
  choices?: Array<{
    delta: {
      content?: string | null
      reasoning?: string | null
      reasoning_content?: string | null
      tool_calls?: Array<{ index: number; function?: { name?: string } }>
    }
    finish_reason: string | null
  }>
}

interface StreamObservation {
  chunkCount: number
  content: string
  sawReasoningField: boolean
  sawReasoningContentField: boolean
  toolNames: Set<string>
  toolIndexes: Set<number>
}

async function observeStream(
  baseUrl: string,
  body: Record<string, unknown>,
  timeoutMs: number
): Promise<StreamObservation> {
  const observation: StreamObservation = {
    chunkCount: 0,
    content: '',
    sawReasoningField: false,
    sawReasoningContentField: false,
    toolNames: new Set(),
    toolIndexes: new Set(),
  }

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, stream: true }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok || !response.body) {
    throw new Error(`probe request failed: HTTP ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''

  function handleLine(line: string): void {
    if (!line.startsWith('data: ')) return
    const payload = line.slice(6)
    if (payload === '[DONE]') return
    let parsed: ProbeChunk
    try {
      parsed = JSON.parse(payload) as ProbeChunk
    } catch {
      return
    }
    const delta = parsed.choices?.[0]?.delta
    if (!delta) return
    observation.chunkCount++
    if (delta.content) observation.content += delta.content
    if (delta.reasoning) observation.sawReasoningField = true
    if (delta.reasoning_content) observation.sawReasoningContentField = true
    for (const tc of delta.tool_calls ?? []) {
      observation.toolIndexes.add(tc.index)
      if (tc.function?.name) observation.toolNames.add(tc.function.name)
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      pending += decoder.decode(value, { stream: true })
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        handleLine(line)
      }
    }
    // Flush any remaining data that arrived without a trailing newline
    if (pending) handleLine(pending)
  } finally {
    reader.releaseLock()
  }

  return observation
}

const ECHO_TOOL = {
  type: 'function',
  function: {
    name: 'echo',
    description: 'Echo the given text back.',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  },
}

const TIME_TOOL = {
  type: 'function',
  function: {
    name: 'time_now',
    description: 'Returns the current time.',
    parameters: { type: 'object', properties: {} },
  },
}

const DATE_TOOL = {
  type: 'function',
  function: {
    name: 'date_today',
    description: "Returns today's date.",
    parameters: { type: 'object', properties: {} },
  },
}

// Reasoning models may spend hundreds of tokens thinking before acting
const PROBE_MAX_TOKENS = 1024

export async function probeModel(
  baseUrl: string,
  model: string,
  timeoutMs = 30_000
): Promise<ProbeResult> {
  const result: ProbeResult = {
    streaming: false,
    toolCalling: false,
    parallelToolCalls: false,
    reasoningStyle: 'none',
    latencyMs: 0,
    // error set on first failure
  }

  // Probe 1: streaming round-trip + reasoning style
  try {
    const start = Date.now()
    const obs = await observeStream(
      baseUrl,
      {
        model,
        messages: [{ role: 'user', content: 'Reply with exactly one word: hi' }],
        max_tokens: PROBE_MAX_TOKENS,
      },
      timeoutMs
    )
    result.latencyMs = Date.now() - start
    result.streaming = obs.chunkCount > 0
    if (obs.sawReasoningField) result.reasoningStyle = 'reasoning-field'
    else if (obs.sawReasoningContentField) result.reasoningStyle = 'reasoning-content-field'
    else if (obs.content.includes('<think>')) result.reasoningStyle = 'think-tags'
  } catch (err: unknown) {
    result.error = err instanceof Error ? err.message : String(err)
    return result // model unreachable — later probes would fail identically
  }

  // Probe 2: forced tool call. Retry — a freshly loaded local model is
  // stochastic on its first calls (observed: cold qwen2.5:7b emits garbage and
  // skips the tool, then calls it reliably once warm). Any success across
  // attempts proves tool-calling; only brand a model tool-less if every attempt
  // misses, so a cold start never produces a false negative.
  for (let attempt = 0; attempt < 3 && !result.toolCalling; attempt++) {
    try {
      const obs = await observeStream(
        baseUrl,
        {
          model,
          messages: [{ role: 'user', content: 'Use the echo tool to echo the word ping. You must call the tool.' }],
          tools: [ECHO_TOOL],
          max_tokens: PROBE_MAX_TOKENS,
        },
        timeoutMs
      )
      result.toolCalling = obs.toolNames.size > 0 || obs.toolIndexes.size > 0
    } catch (err: unknown) {
      result.error ??= err instanceof Error ? err.message : String(err)
    }
  }

  // Probe 3: parallel tool calls (only meaningful if tools work at all)
  if (result.toolCalling) {
    try {
      const obs = await observeStream(
        baseUrl,
        {
          model,
          messages: [
            { role: 'user', content: 'Call BOTH the time_now tool and the date_today tool, in this single turn.' },
          ],
          tools: [TIME_TOOL, DATE_TOOL],
          max_tokens: PROBE_MAX_TOKENS,
        },
        timeoutMs
      )
      result.parallelToolCalls = obs.toolNames.size >= 2 || obs.toolIndexes.size >= 2
    } catch (err: unknown) {
      result.error ??= err instanceof Error ? err.message : String(err)
    }
  }

  return result
}
