import type { SqliteStorage, MemoryEntry } from '../storage'
import type { MemoryInput, IncomingMessage, ContentBlock, Embedder } from './types'

const MAX_MEMORIES_TO_SCAN = 200
const SEMANTIC_SIM_THRESHOLD = 0.45 // replaces the old 0.1 that passed almost anything
const SEMANTIC_CANDIDATES = 20
const COSINE_WEIGHT = 2.0
const RECENCY_WEIGHT = 0.5
const RECENCY_HALF_LIFE_DAYS = 7
const TIER_WEIGHTS: Record<string, number> = { semantic: 0.5, working: 0.4, episodic: 0.25 }
const MAX_ERROR_TEXT_LENGTH = 500
const MAX_INJECT_CONTENT_LENGTH = 300
const MAX_FIX_INPUT_LENGTH = 200
const MAX_WORKING_ASK_LENGTH = 300
const FIX_LOOKBACK_MESSAGES = 8

const PRUNE_AGE_DAYS = 30
const WORKING_TTL_HOURS = 24
const CLUSTER_SIM_THRESHOLD = 0.85
const CLUSTER_MIN_SIZE = 3
const CONSOLIDATE_SCAN_LIMIT = 200
const REEMBED_BATCH_SIZE = 32

export interface ConsolidateResult {
  pruned: number
  evictedWorking: number
  promoted: number
  reembedded: number
}

function extractQueryWords(text: string): string[] {
  return text
    .split(/\W+/)
    .filter((w) => w.length >= 2)
    .map((w) => w.toLowerCase())
}

function scoreMemoryKeyword(entry: MemoryEntry, queryWords: string[]): number {
  const contentLower = entry.content.toLowerCase()
  let score = 0
  for (const word of queryWords) {
    if (contentLower.includes(word)) {
      score += 1
    }
  }
  return score
}

function recencyScore(createdAt: Date): number {
  const ageDays = (Date.now() - createdAt.getTime()) / (24 * 60 * 60 * 1000)
  return RECENCY_WEIGHT * Math.exp((-Math.LN2 * ageDays) / RECENCY_HALF_LIFE_DAYS)
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + '...'
}

function injectionLabel(entry: MemoryEntry): string {
  if (entry.tier === 'working') return 'session'
  if (entry.tags.includes('fix-pair')) return 'past fix'
  if (entry.type === 'failure') return 'past failure'
  return 'repo fact'
}

function extractToolResultErrors(blocks: ContentBlock[]): string[] {
  const errors: string[] = []
  for (const block of blocks) {
    if (block.type === 'tool_result' && block.is_error === true) {
      let text: string
      if (typeof block.content === 'string') {
        text = block.content
      } else {
        text = block.content.map((c) => c.text).join('\n')
      }
      errors.push(text.slice(0, MAX_ERROR_TEXT_LENGTH))
    }
  }
  return errors
}

function collectToolUses(messages: IncomingMessage[]): Map<string, { name: string; input: Record<string, unknown> }> {
  const map = new Map<string, { name: string; input: Record<string, unknown> }>()
  for (const msg of messages) {
    if (msg.role !== 'assistant' || typeof msg.content === 'string') continue
    for (const block of msg.content) {
      if (block.type === 'tool_use') {
        map.set(block.id, { name: block.name, input: block.input })
      }
    }
  }
  return map
}

function toolResultText(block: Extract<ContentBlock, { type: 'tool_result' }>): string {
  return typeof block.content === 'string'
    ? block.content
    : block.content.map((c) => c.text).join('\n')
}

export class MemoryEngine {
  constructor(
    private readonly storage: SqliteStorage,
    private readonly embedder: Embedder | null = null
  ) {}

  async save(input: MemoryInput): Promise<void> {
    const entry = this.storage.saveMemory({
      type: input.type,
      content: input.content,
      tags: input.tags,
      sessionId: input.sessionId ?? null,
      ...(input.tier !== undefined && { tier: input.tier }),
    })

    if (!this.embedder) return
    // Backfill: a duplicate save may carry an embedding the original never got
    // (embedder was null or embed failed on first save).
    if (!entry.created && this.storage.hasEmbedding(entry.id, 'memory')) return

    try {
      const result = await this.embedder.embed([input.content])
      const vector = result.embeddings[0]
      if (vector) {
        this.storage.upsertEmbedding(entry.id, 'memory', vector)
      }
    } catch {
      // Embedding is best-effort
    }
  }

  /**
   * Save the auto-generated repository summary, superseding any previous one.
   * Summaries drift slightly with every code change, so content_hash dedup
   * never collapses them — without this, one stale semantic row accumulates
   * per restart and they slowly crowd the memory budget.
   */
  async saveRepoSummary(content: string): Promise<void> {
    const stale = this.storage
      .queryMemories(CONSOLIDATE_SCAN_LIMIT)
      .filter(
        (m) =>
          m.type === 'repository' &&
          m.tags.includes('auto-generated') &&
          m.content !== content
      )
      .map((m) => m.id)
    this.storage.deleteMemories(stale)
    await this.save({ type: 'repository', content, tags: ['auto-generated'] })
  }

  async query(text: string, limit = 5, sessionId?: string): Promise<MemoryEntry[]> {
    const queryWords = extractQueryWords(text)
    const candidates = new Map<number, { entry: MemoryEntry; cosine: number }>()

    // Semantic candidates — fetched by id so relevance is not capped by recency
    if (this.embedder && this.storage.hasAnyEmbeddings('memory')) {
      try {
        const result = await this.embedder.embed([text])
        const queryVector = result.embeddings[0]
        if (queryVector) {
          const scored = this.storage
            .searchSimilar('memory', queryVector, SEMANTIC_CANDIDATES)
            .filter((s) => s.similarity >= SEMANTIC_SIM_THRESHOLD)
          const entries = this.storage.getMemoriesByIds(scored.map((s) => s.entityId))
          const byId = new Map(entries.map((e) => [e.id, e]))
          for (const s of scored) {
            const entry = byId.get(s.entityId)
            if (entry) candidates.set(entry.id, { entry, cosine: s.similarity })
          }
        }
      } catch {
        // Embedder down — keyword-only below
      }
    }

    // Keyword candidates over the recent window
    if (queryWords.length > 0) {
      for (const entry of this.storage.queryMemories(MAX_MEMORIES_TO_SCAN)) {
        if (candidates.has(entry.id)) continue
        if (scoreMemoryKeyword(entry, queryWords) > 0) {
          candidates.set(entry.id, { entry, cosine: 0 })
        }
      }
    }

    const ranked = Array.from(candidates.values())
      // Working-tier memories belong to one session only
      .filter(({ entry }) => entry.tier !== 'working' || entry.sessionId === sessionId)
      .map(({ entry, cosine }) => {
        const keyword =
          queryWords.length > 0 ? scoreMemoryKeyword(entry, queryWords) / queryWords.length : 0
        const score =
          COSINE_WEIGHT * cosine +
          keyword +
          recencyScore(entry.createdAt) +
          (TIER_WEIGHTS[entry.tier] ?? 0)
        return { entry, score }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((r) => r.entry)

    this.storage.touchMemories(ranked.map((m) => m.id))
    return ranked
  }

  inject(entries: MemoryEntry[]): string {
    if (entries.length === 0) return ''
    const lines = entries.map(
      (entry) => `- [${injectionLabel(entry)}] ${truncate(entry.content, MAX_INJECT_CONTENT_LENGTH)}`
    )
    return `## Relevant Memory\n${lines.join('\n')}`
  }

  /**
   * Capture from the latest turn: new tool errors (episodic), failure→fix
   * pairs (a tool that errored earlier in the visible window succeeding now),
   * and the session's current ask (working tier). Mid-history errors from
   * replayed conversations are intentionally skipped; content_hash dedup
   * absorbs retries.
   */
  async captureFromMessages(messages: IncomingMessage[], sessionId: string): Promise<void> {
    const last = messages[messages.length - 1]
    if (!last) return

    const window = messages.slice(-FIX_LOOKBACK_MESSAGES)
    const toolUses = collectToolUses(window)

    if (typeof last.content !== 'string') {
      // 1. Plain failures from the latest message
      for (const errorText of extractToolResultErrors(last.content)) {
        await this.save({ type: 'failure', content: errorText, tags: ['auto-extracted'], sessionId })
      }

      // 2. Failure→fix pairs: successful results in the latest message whose
      // tool name failed earlier in the window
      const priorErrorsByTool = new Map<string, string>()
      for (const msg of window.slice(0, -1)) {
        if (msg.role !== 'user' || typeof msg.content === 'string') continue
        for (const block of msg.content) {
          if (block.type === 'tool_result' && block.is_error === true) {
            const use = toolUses.get(block.tool_use_id)
            if (use) priorErrorsByTool.set(use.name, toolResultText(block).slice(0, MAX_ERROR_TEXT_LENGTH))
          }
        }
      }
      for (const block of last.content) {
        if (block.type !== 'tool_result' || block.is_error === true) continue
        const use = toolUses.get(block.tool_use_id)
        if (!use) continue
        const priorError = priorErrorsByTool.get(use.name)
        if (priorError === undefined) continue
        await this.save({
          type: 'failure',
          content:
            `Failed: ${priorError.slice(0, MAX_FIX_INPUT_LENGTH)}\n` +
            `Fixed by: ${use.name}(${JSON.stringify(use.input).slice(0, MAX_FIX_INPUT_LENGTH)})`,
          tags: ['fix-pair'],
          sessionId,
        })
      }
    }

    // 3. Working-tier session ask: last user-authored text in the window
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (!msg || msg.role !== 'user') continue
      const text =
        typeof msg.content === 'string'
          ? msg.content
          : msg.content.filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n')
      const trimmed = text.trim()
      if (trimmed.length > 0) {
        await this.save({
          type: 'failure', // type is the content kind; tier drives lifecycle
          content: `Session ask: ${trimmed.slice(0, MAX_WORKING_ASK_LENGTH)}`,
          tags: ['session-ask'],
          sessionId,
          tier: 'working',
        })
        break
      }
    }
  }

  /** Startup maintenance — never call on the request path. */
  async consolidate(): Promise<ConsolidateResult> {
    const now = Date.now()
    const all = this.storage.queryMemories(CONSOLIDATE_SCAN_LIMIT)

    // 1. Prune stale unaccessed episodic memories
    const pruneIds = all
      .filter(
        (m) =>
          m.tier === 'episodic' &&
          m.accessCount === 0 &&
          now - m.createdAt.getTime() > PRUNE_AGE_DAYS * 24 * 60 * 60 * 1000
      )
      .map((m) => m.id)
    this.storage.deleteMemories(pruneIds)

    // 2. Evict expired working-tier asks
    const evictIds = all
      .filter(
        (m) =>
          m.tier === 'working' &&
          now - m.createdAt.getTime() > WORKING_TTL_HOURS * 60 * 60 * 1000
      )
      .map((m) => m.id)
    this.storage.deleteMemories(evictIds)

    // 3. Promote clusters of similar episodic memories to one semantic representative
    const removed = new Set([...pruneIds, ...evictIds])
    const episodic = all.filter((m) => m.tier === 'episodic' && !removed.has(m.id))
    let promoted = 0
    const consumed = new Set<number>()
    for (const mem of episodic) {
      if (consumed.has(mem.id)) continue
      const vector = this.storage.getEmbedding(mem.id, 'memory')
      if (!vector) continue
      const cluster = this.storage
        .searchSimilar('memory', vector, CLUSTER_MIN_SIZE + 2)
        .filter((s) => s.similarity >= CLUSTER_SIM_THRESHOLD)
        .map((s) => s.entityId)
        .filter((id) => !consumed.has(id) && episodic.some((e) => e.id === id))
      if (cluster.length >= CLUSTER_MIN_SIZE) {
        // Keep the most recent as the semantic representative
        const members = episodic.filter((e) => cluster.includes(e.id))
        members.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        const keep = members[0]!
        const drop = members.slice(1).map((m) => m.id)
        this.storage.setMemoryTier(keep.id, 'semantic')
        this.storage.deleteMemories(drop)
        for (const id of cluster) consumed.add(id)
        promoted++
      }
    }

    // 4. Re-embed memories missing vectors (e.g. after an embedding-model swap)
    let reembedded = 0
    if (this.embedder) {
      const missing = this.storage.getMemoriesMissingEmbeddings(CONSOLIDATE_SCAN_LIMIT)
      for (let i = 0; i < missing.length; i += REEMBED_BATCH_SIZE) {
        const batch = missing.slice(i, i + REEMBED_BATCH_SIZE)
        try {
          const result = await this.embedder.embed(batch.map((m) => m.content))
          for (let j = 0; j < batch.length; j++) {
            const vector = result.embeddings[j]
            if (vector) {
              this.storage.upsertEmbedding(batch[j]!.id, 'memory', vector)
              reembedded++
            }
          }
        } catch {
          break // embedder down — try again next startup
        }
      }
    }

    return { pruned: pruneIds.length, evictedWorking: evictIds.length, promoted, reembedded }
  }
}
