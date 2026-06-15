import { readFileSync, readdirSync, statSync, watch } from 'node:fs'
import { join, relative, extname } from 'node:path'
import { createHash } from 'node:crypto'
import type { SqliteStorage } from '../storage'
import { parseTypeScript } from './parser'
import type { IndexOptions, IndexResult, Embedder } from './types'

const DEFAULT_IGNORE = new Set(['node_modules', 'dist', '.git', 'coverage'])
const INDEXABLE_EXTENSIONS = new Set(['.ts', '.tsx'])
const SNIPPET_LINES = 20

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

function detectLanguage(ext: string): string | null {
  switch (ext) {
    case '.ts':
      return 'typescript'
    case '.tsx':
      return 'tsx'
    default:
      return null
  }
}

function walkDirectory(dir: string, ignoreSet: Set<string>, result: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }

  for (const entry of entries) {
    if (ignoreSet.has(entry)) continue
    if (entry.startsWith('.')) continue

    const fullPath = join(dir, entry)
    let stat
    try {
      stat = statSync(fullPath)
    } catch {
      continue
    }

    if (stat.isDirectory()) {
      walkDirectory(fullPath, ignoreSet, result)
    } else if (stat.isFile() && INDEXABLE_EXTENSIONS.has(extname(entry))) {
      result.push(fullPath)
    }
  }
}

export class Indexer {
  constructor(
    private readonly storage: SqliteStorage,
    private readonly embedder: Embedder | null = null
  ) {}

  async index(options: IndexOptions): Promise<IndexResult> {
    const start = Date.now()
    const ignoreSet = new Set([...DEFAULT_IGNORE, ...(options.ignore ?? [])])

    const filePaths: string[] = []
    walkDirectory(options.workingDirectory, ignoreSet, filePaths)

    let filesIndexed = 0
    let symbolsExtracted = 0
    let importsFound = 0
    const pendingEmbeddings: Array<{ fileId: number; text: string }> = []

    for (const fullPath of filePaths) {
      let content: string
      try {
        content = readFileSync(fullPath, 'utf-8')
      } catch {
        continue
      }

      const hash = hashContent(content)
      const relPath = relative(options.workingDirectory, fullPath)
      const existing = this.storage.getFile(relPath)

      if (existing && existing.hash === hash) {
        continue
      }

      const ext = extname(fullPath)
      const language = detectLanguage(ext)
      const snippet = content.split('\n').slice(0, SNIPPET_LINES).join('\n')
      const file = this.storage.upsertFile(relPath, hash, language, snippet)

      const parseLanguage = ext === '.tsx' ? 'tsx' : 'typescript'
      const parseResult = parseTypeScript(content, parseLanguage)

      this.storage.deleteSymbolsForFile(file.id)
      this.storage.insertSymbols(file.id, parseResult.symbols)
      this.storage.upsertImports(file.id, parseResult.imports)

      if (this.embedder) {
        pendingEmbeddings.push({
          fileId: file.id,
          text: [
            relPath,
            parseResult.symbols.map((s) => s.name).join(' '),
            parseResult.imports.join(' '),
            snippet,
          ].join('\n'),
        })
      }

      filesIndexed++
      symbolsExtracted += parseResult.symbols.length
      importsFound += parseResult.imports.length
    }

    if (this.embedder && pendingEmbeddings.length > 0) {
      const BATCH_SIZE = 32
      for (let i = 0; i < pendingEmbeddings.length; i += BATCH_SIZE) {
        const batch = pendingEmbeddings.slice(i, i + BATCH_SIZE)
        try {
          const result = await this.embedder.embed(batch.map((p) => p.text))
          for (let j = 0; j < batch.length; j++) {
            const vector = result.embeddings[j]
            if (vector) {
              this.storage.upsertEmbedding(batch[j]!.fileId, 'file', vector)
            }
          }
        } catch {
          // Embedding is best-effort — continue without this batch
        }
      }
    }

    const repoSummary = this.generateRepoSummary()

    return {
      filesIndexed,
      symbolsExtracted,
      importsFound,
      durationMs: Date.now() - start,
      repoSummary,
    }
  }

  async indexFile(absolutePath: string, workingDirectory: string): Promise<void> {
    const relPath = relative(workingDirectory, absolutePath)
    let content: string
    try {
      content = readFileSync(absolutePath, 'utf-8')
    } catch {
      // File was deleted or renamed — drop it from the index
      this.storage.deleteFileByPath(relPath)
      return
    }

    const hash = hashContent(content)
    const ext = extname(absolutePath)
    const language = detectLanguage(ext)
    const snippet = content.split('\n').slice(0, SNIPPET_LINES).join('\n')
    const file = this.storage.upsertFile(relPath, hash, language, snippet)

    const parseLanguage = ext === '.tsx' ? 'tsx' : 'typescript'
    const parseResult = parseTypeScript(content, parseLanguage)

    this.storage.deleteSymbolsForFile(file.id)
    this.storage.insertSymbols(file.id, parseResult.symbols)
    this.storage.upsertImports(file.id, parseResult.imports)

    if (this.embedder) {
      const embeddingText = [
        relPath,
        parseResult.symbols.map((s) => s.name).join(' '),
        parseResult.imports.join(' '),
        snippet,
      ].join('\n')
      try {
        const result = await this.embedder.embed([embeddingText])
        const vector = result.embeddings[0]
        if (vector) {
          this.storage.upsertEmbedding(file.id, 'file', vector)
        }
      } catch {
        // Embedding is best-effort
      }
    }
  }

  private generateRepoSummary(): string {
    const grouped = this.storage.getSymbolsGroupedByFile()
    if (grouped.size === 0) return ''

    const lines: string[] = ['Repository index summary:']
    for (const [path, symbolNames] of grouped) {
      if (symbolNames.length > 0) {
        lines.push(`  ${path}: ${symbolNames.join(', ')}`)
      } else {
        lines.push(`  ${path}`)
      }
    }
    return lines.join('\n')
  }

  watchAndReindex(
    workingDirectory: string,
    opts?: { ignore?: string[] }
  ): () => void {
    const ignoreSet = new Set([...DEFAULT_IGNORE, ...(opts?.ignore ?? [])])
    const debounceMap = new Map<string, ReturnType<typeof setTimeout>>()

    const watcher = watch(
      workingDirectory,
      { recursive: true },
      (_eventType, filename) => {
        if (!filename) return
        const ext = extname(filename)
        if (!INDEXABLE_EXTENSIONS.has(ext)) return

        const parts = filename.split('/')
        if (parts.some((p) => ignoreSet.has(p))) return

        const existing = debounceMap.get(filename)
        if (existing) clearTimeout(existing)

        const timer = setTimeout(() => {
          debounceMap.delete(filename)
          const absPath = join(workingDirectory, filename)
          void this.indexFile(absPath, workingDirectory)
        }, 500)

        debounceMap.set(filename, timer)
      }
    )

    return () => {
      watcher.close()
      for (const timer of debounceMap.values()) {
        clearTimeout(timer)
      }
      debounceMap.clear()
    }
  }
}
