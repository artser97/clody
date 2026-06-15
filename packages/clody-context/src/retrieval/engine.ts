import type { SqliteStorage } from "../storage"
import { RecentEditsCache } from "./cache"
import type { RetrievalParams, CodeChunk, RetrievalResult, Embedder } from "./types"

const SEMANTIC_THRESHOLD = 0.3
const SEMANTIC_TOP_K = 5
const CHARS_PER_TOKEN = 4
const WEIGHT = {
  SYMBOL: 10,
  MENTIONED: 8,
  SEMANTIC: 3,
  RECENT: 1,
} as const

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'what', 'how', 'why',
  'where', 'when', 'can', 'you', 'your', 'are', 'was', 'not', 'but', 'all',
  'any', 'has', 'have', 'does', 'please', 'fix', 'add', 'make', 'use', 'run',
  'file', 'files', 'code', 'into', 'about', 'should', 'would', 'could',
])
const MAX_QUERY_WORDS = 8
const MIN_WORD_LENGTH = 3

function extractQueryWords(query: string): string[] {
  return query
    .split(/\W+/)
    .filter((w) => w.length >= MIN_WORD_LENGTH && !STOPWORDS.has(w.toLowerCase()))
    .slice(0, MAX_QUERY_WORDS)
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

// Module-level cache shared across all engine instances in the same process
const recentEditsCache = new RecentEditsCache()

export class RetrievalEngine {
  constructor(
    private readonly storage: SqliteStorage,
    private readonly embedder: Embedder
  ) {}

  async query(params: RetrievalParams): Promise<RetrievalResult> {
    const start = Date.now()

    // Map from filePath -> { score, reason, snippet }
    const scoreMap = new Map<string, { score: number; reason: CodeChunk['reason']; snippet: string }>()

    function addScore(filePath: string, delta: number, reason: CodeChunk['reason'], snippet: string): void {
      const existing = scoreMap.get(filePath)
      if (existing) {
        existing.score += delta
        // Upgrade reason if higher-priority signal found
        const priority: Record<CodeChunk['reason'], number> = {
          'symbol-match': 4, mentioned: 3, semantic: 2, 'recent-edit': 1,
        }
        if ((priority[reason] ?? 0) > (priority[existing.reason] ?? 0)) {
          existing.reason = reason
        }
      } else {
        scoreMap.set(filePath, { score: delta, reason, snippet })
      }
    }

    // 1. Symbol match — WEIGHT.SYMBOL per matching symbol (one score addition per file)
    const words = extractQueryWords(params.query)
    const symbolMode: 'contains' | 'prefix' = words.length <= 2 ? 'contains' : 'prefix'
    const matchedFiles = new Set<string>()
    for (const word of words) {
      const matches = this.storage.searchSymbolsByName(word, symbolMode)
      for (const match of matches) {
        if (!matchedFiles.has(match.filePath)) {
          matchedFiles.add(match.filePath)
          const snippet = this.storage.getSnippet(match.fileId)
          if (snippet.length > 0) {
            addScore(match.filePath, WEIGHT.SYMBOL, 'symbol-match', snippet)
          }
        }
      }
    }

    // 2. Mentioned files — WEIGHT.MENTIONED
    if (params.mentionedFiles) {
      for (const mentionedPath of params.mentionedFiles) {
        const file = this.storage.getFile(mentionedPath)
        if (file) {
          const snippet = this.storage.getSnippet(file.id)
          if (snippet.length > 0) {
            addScore(mentionedPath, WEIGHT.MENTIONED, 'mentioned', snippet)
          }
        }
      }
    }

    // 3. Recent edits — WEIGHT.RECENT (TTL-cached)
    const recentFiles = await recentEditsCache.getRecentFiles(params.workingDirectory)
    for (const recentFile of recentFiles) {
      const file = this.storage.getFile(recentFile)
      if (file) {
        const snippet = this.storage.getSnippet(file.id)
        if (snippet.length > 0) {
          addScore(recentFile, WEIGHT.RECENT, 'recent-edit', snippet)
        }
      }
    }

    // 4. Semantic search — WEIGHT.SEMANTIC * similarity (float contribution)
    if (this.storage.hasAnyEmbeddings('file')) {
      try {
        const queryEmbedResult = await this.embedder.embed([params.query])
        const queryVector = queryEmbedResult.embeddings[0]
        if (queryVector) {
          const scored = this.storage
            .searchSimilar('file', queryVector, SEMANTIC_TOP_K)
            .filter((s) => s.similarity > SEMANTIC_THRESHOLD)

          for (const { entityId, similarity } of scored) {
            const file = this.storage.getFileById(entityId)
            if (file) {
              const snippet = this.storage.getSnippet(file.id)
              if (snippet.length > 0) {
                const semanticScore = Math.floor(WEIGHT.SEMANTIC * similarity * 10) / 10
                addScore(file.path, semanticScore, 'semantic', snippet)
              }
            }
          }
        }
      } catch {
        // Embedder down (or circuit open) — semantic signal is lost, keyword/symbol/recency signals still apply
      }
    }

    // Sort by score descending, limit to maxChunks, respect maxTokens
    const sorted = Array.from(scoreMap.entries())
      .map(([filePath, { score, reason, snippet }]) => ({
        filePath,
        snippet,
        relevanceScore: score,
        reason,
      }))
      .sort((a, b) => b.relevanceScore - a.relevanceScore)

    const chunks: CodeChunk[] = []
    let totalTokens = 0
    for (const chunk of sorted) {
      if (chunks.length >= params.maxChunks) break
      const tokens = estimateTokens(chunk.snippet)
      if (totalTokens + tokens > params.maxTokens) continue
      chunks.push(chunk)
      totalTokens += tokens
    }

    return {
      chunks,
      totalTokens,
      durationMs: Date.now() - start,
    }
  }
}
