import type { RetrievalEngine } from "../retrieval/engine"
import type { MemoryEngine } from "../memory/engine"
import { extractSignals } from "./signals"
import type { IncomingMessage, BuiltContext } from "./types"

// clody-v2: minimal session shape (was @clody/contracts in v1)
export interface Session {
  id: string
  workingDirectory: string
}

const RETRIEVAL_BUDGET_RATIO = 0.5 // Half the token budget reserved for retrieval; the rest is for conversation
const DEFAULT_MAX_CHUNKS = 10
const OUTPUT_RESERVE_TOKENS = 1024 // Leave headroom for the model's own output
const MIN_INJECTION_TOKENS = 200 // Below this, injected context is too small to help
const MEMORY_LIMIT = 5

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export class ContextBuilder {
  constructor(
    private readonly retrieval: RetrievalEngine,
    private readonly memory: MemoryEngine,
    private readonly maxContextTokens: number
  ) {}

  async build(
    messages: IncomingMessage[],
    session: Session,
    baseTokens = 0,
    outputReserveTokens = OUTPUT_RESERVE_TOKENS
  ): Promise<BuiltContext> {
    // Capture runs every turn, but AFTER the memory query below — otherwise the
    // current turn's own ask would be saved and immediately echoed back into
    // this same request's context.
    const capture = (): Promise<void> =>
      this.memory.captureFromMessages(
        messages as Parameters<typeof this.memory.captureFromMessages>[0],
        session.id
      )

    const remaining =
      this.maxContextTokens - baseTokens - Math.max(OUTPUT_RESERVE_TOKENS, outputReserveTokens)
    if (remaining < MIN_INJECTION_TOKENS) {
      // clody-v2: capture is best-effort and off the latency path (was awaited in v1)
      void capture().catch(() => {})
      return { systemPromptPrefix: '', chunksUsed: 0, memoriesUsed: 0, estimatedTokens: 0 }
    }

    const signals = extractSignals(messages, session.id, session.workingDirectory)
    const tokenBudget = Math.min(
      remaining,
      Math.floor(this.maxContextTokens * RETRIEVAL_BUDGET_RATIO)
    )

    // Query memory and retrieval in parallel (both are read-only)
    const [memoryEntries, retrievalResult] = await Promise.all([
      signals.queryText.length > 0
        ? this.memory.query(signals.queryText, MEMORY_LIMIT, session.id)
        : Promise.resolve([]),
      signals.queryText.length > 0
        ? this.retrieval.query({
            query: signals.queryText,
            workingDirectory: session.workingDirectory,
            ...(signals.mentionedFiles.length > 0 && { mentionedFiles: signals.mentionedFiles }),
            maxChunks: DEFAULT_MAX_CHUNKS,
            maxTokens: tokenBudget,
          })
        : Promise.resolve({ chunks: [], totalTokens: 0, durationMs: 0 }),
    ])

    // clody-v2: capture is best-effort and off the latency path (was awaited in v1)
    void capture().catch(() => {})

    // Build the prefix
    const sections: string[] = []

    if (memoryEntries.length > 0) {
      sections.push(this.memory.inject(memoryEntries))
    }

    if (retrievalResult.chunks.length > 0) {
      const codeLines = retrievalResult.chunks.map((chunk) => {
        const header = `### ${chunk.filePath} (${chunk.reason}, score: ${chunk.relevanceScore.toFixed(2)})`
        return `${header}\n\`\`\`\n${chunk.snippet}\n\`\`\``
      })
      sections.push(`## Relevant Code\n${codeLines.join('\n\n')}`)
    }

    if (sections.length === 0) {
      return {
        systemPromptPrefix: '',
        chunksUsed: 0,
        memoriesUsed: 0,
        estimatedTokens: 0,
      }
    }

    const prefix = `<clody-context>\n${sections.join('\n\n')}\n</clody-context>`

    return {
      systemPromptPrefix: prefix,
      chunksUsed: retrievalResult.chunks.length,
      memoriesUsed: memoryEntries.length,
      estimatedTokens: estimateTokens(prefix),
    }
  }
}
