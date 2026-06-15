import { createHash } from 'node:crypto'
import { Database } from "bun:sqlite"
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema"
import type { IndexedFile, Symbol, EmbeddingRecord, MemoryEntry, MemoryType, MemoryTier } from "./types"
import { VectorIndex } from "./vector-index"

interface SymbolInput {
  name: string
  kind: 'function' | 'class' | 'interface' | 'type'
  line: number
  col: number
}

interface MemoryInput {
  type: MemoryType
  tier?: MemoryTier
  content: string
  tags: string[]
  sessionId: string | null
}

interface FileRow {
  id: number
  path: string
  hash: string
  language: string | null
  snippet: string
  indexed_at: number
}

interface SymbolRow {
  id: number
  file_id: number
  name: string
  kind: string
  line: number
  col: number
}

interface SymbolWithPathRow extends SymbolRow {
  file_path: string
}

interface MemoryRow {
  id: number
  type: string
  tier: string
  content: string
  tags: string
  session_id: string | null
  content_hash: string | null
  created_at: number
  last_accessed_at: number | null
  access_count: number
}

interface EmbeddingRow {
  entity_id: number
  entity_type: string
  vector: Uint8Array
}

interface SnippetRow {
  snippet: string
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 32)
}

function rowToFile(row: FileRow): IndexedFile {
  return {
    id: row.id,
    path: row.path,
    hash: row.hash,
    language: row.language,
    snippet: row.snippet,
    indexedAt: new Date(row.indexed_at),
  }
}

function rowToMemory(row: MemoryRow): MemoryEntry {
  return {
    id: row.id,
    type: row.type as MemoryType,
    tier: row.tier as MemoryTier,
    content: row.content,
    tags: JSON.parse(row.tags) as string[],
    sessionId: row.session_id,
    createdAt: new Date(row.created_at),
    lastAccessedAt: row.last_accessed_at === null ? null : new Date(row.last_accessed_at),
    accessCount: row.access_count,
  }
}

function vectorToBuffer(vector: number[] | Float32Array): Uint8Array {
  const f32 = vector instanceof Float32Array ? vector : new Float32Array(vector)
  return new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength)
}

function uint8ArrayToVector(value: Uint8Array): Float32Array {
  return new Float32Array(value.buffer, value.byteOffset, value.byteLength / 4)
}

function cosineStrict(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Cosine dimension mismatch: ${a.length} vs ${b.length}`)
  }
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

export class SqliteStorage {
  private readonly db: Database
  private readonly vectorIndexes = new Map<'file' | 'memory', VectorIndex>()

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.exec("PRAGMA journal_mode = WAL;")
    this.db.exec("PRAGMA foreign_keys = ON;")

    const versionRow = this.db.prepare("PRAGMA user_version").get() as { user_version: number } | undefined
    const version = versionRow?.user_version ?? 0
    if (version !== SCHEMA_VERSION) {
      // Derived tables (files/symbols/imports/embeddings) are a stale cache —
      // recreate. Memories are USER DATA: export before the drop, reimport after.
      const preserved = this.exportMemories()
      this.dropAllTables()
      this.db.exec(SCHEMA_SQL)
      this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`)
      this.reimportMemories(preserved)
    }
  }

  private dropAllTables(): void {
    // FK enforcement can block dropping a parent table if a future child FK
    // lacks ON DELETE CASCADE — disable it for the duration of the recreate.
    this.db.exec("PRAGMA foreign_keys = OFF;")
    try {
      const tables = this.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>
      for (const t of tables) {
        this.db.exec(`DROP TABLE IF EXISTS "${t.name}"`)
      }
    } finally {
      this.db.exec("PRAGMA foreign_keys = ON;")
    }
  }

  /** Raw memory rows captured before a schema recreate. Best-effort: a DB so old
   *  it lacks the memories table (or columns) exports nothing. */
  private exportMemories(): Array<Record<string, unknown>> {
    try {
      return this.db.prepare("SELECT * FROM memories").all() as Array<Record<string, unknown>>
    } catch {
      return []
    }
  }

  private reimportMemories(rows: Array<Record<string, unknown>>): void {
    if (rows.length === 0) return
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO memories
         (type, tier, content, tags, session_id, content_hash, created_at, last_accessed_at, access_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const run = this.db.transaction((all: Array<Record<string, unknown>>) => {
      for (const r of all) {
        try {
          insert.run(
            (r["type"] as string) ?? "repository",
            (r["tier"] as string) ?? "episodic",
            (r["content"] as string) ?? "",
            (r["tags"] as string) ?? "[]",
            (r["session_id"] as string | null) ?? null,
            (r["content_hash"] as string | null) ?? null,
            (r["created_at"] as number) ?? Date.now(),
            (r["last_accessed_at"] as number | null) ?? null,
            (r["access_count"] as number) ?? 0,
          )
        } catch {
          /* a row that no longer fits the new schema is dropped — best effort */
        }
      }
    })
    run(rows)
  }

  upsertFile(path: string, hash: string, language: string | null, snippet: string): IndexedFile {
    const now = Date.now()
    this.db.prepare(`
      INSERT INTO files (path, hash, language, snippet, indexed_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        hash = excluded.hash,
        language = excluded.language,
        snippet = excluded.snippet,
        indexed_at = excluded.indexed_at
    `).run(path, hash, language, snippet, now)

    const row = this.db.prepare('SELECT * FROM files WHERE path = ?').get(path) as FileRow
    return rowToFile(row)
  }

  getFile(path: string): IndexedFile | null {
    const row = this.db.prepare('SELECT * FROM files WHERE path = ?').get(path) as FileRow | undefined
    if (!row) return null
    return rowToFile(row)
  }

  getFileById(id: number): IndexedFile | null {
    const row = this.db.prepare('SELECT * FROM files WHERE id = ?').get(id) as FileRow | undefined
    if (!row) return null
    return rowToFile(row)
  }

  getSnippet(fileId: number): string {
    const row = this.db.prepare('SELECT snippet FROM files WHERE id = ?').get(fileId) as SnippetRow | undefined
    return row?.snippet ?? ''
  }

  listFiles(): IndexedFile[] {
    const rows = this.db.prepare('SELECT * FROM files ORDER BY path').all() as FileRow[]
    return rows.map(rowToFile)
  }

  deleteFileByPath(path: string): void {
    const row = this.db.prepare('SELECT id FROM files WHERE path = ?').get(path) as
      | { id: number }
      | undefined
    if (!row) return
    const run = this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM embeddings WHERE entity_id = ? AND entity_type = 'file'")
        .run(row.id)
      // symbols and imports cascade via ON DELETE CASCADE
      this.db.prepare('DELETE FROM files WHERE id = ?').run(row.id)
    })
    run()
    this.vectorIndexes.get('file')?.remove(row.id)
  }

  deleteSymbolsForFile(fileId: number): void {
    this.db.prepare('DELETE FROM symbols WHERE file_id = ?').run(fileId)
  }

  insertSymbols(fileId: number, symbols: SymbolInput[]): void {
    const stmt = this.db.prepare(
      'INSERT INTO symbols (file_id, name, kind, line, col) VALUES (?, ?, ?, ?, ?)'
    )
    const insertMany = this.db.transaction((items: SymbolInput[]) => {
      for (const s of items) {
        stmt.run(fileId, s.name, s.kind, s.line, s.col)
      }
    })
    insertMany(symbols)
  }

  searchSymbolsByName(
    nameFragment: string,
    mode: 'contains' | 'prefix' = 'contains'
  ): Array<Symbol & { filePath: string }> {
    const pattern = mode === 'prefix' ? `${nameFragment}%` : `%${nameFragment}%`
    const rows = this.db.prepare(`
      SELECT s.*, f.path as file_path
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      WHERE s.name LIKE ?
      ORDER BY s.name
    `).all(pattern) as SymbolWithPathRow[]

    return rows.map((row) => ({
      id: row.id,
      fileId: row.file_id,
      name: row.name,
      kind: row.kind as Symbol['kind'],
      line: row.line,
      col: row.col,
      filePath: row.file_path,
    }))
  }

  getSymbolsGroupedByFile(): Map<string, string[]> {
    const rows = this.db.prepare(`
      SELECT f.path AS path, s.name AS name
      FROM files f
      LEFT JOIN symbols s ON s.file_id = f.id
      ORDER BY f.path, s.id
    `).all() as Array<{ path: string; name: string | null }>

    const grouped = new Map<string, string[]>()
    for (const row of rows) {
      const list = grouped.get(row.path) ?? []
      if (row.name !== null) list.push(row.name)
      grouped.set(row.path, list)
    }
    return grouped
  }

  upsertImports(fromFileId: number, toPaths: string[]): void {
    const deleteStmt = this.db.prepare('DELETE FROM imports WHERE from_file_id = ?')
    const insertStmt = this.db.prepare(
      'INSERT INTO imports (from_file_id, to_path) VALUES (?, ?)'
    )
    const upsert = this.db.transaction((paths: string[]) => {
      deleteStmt.run(fromFileId)
      for (const p of paths) {
        insertStmt.run(fromFileId, p)
      }
    })
    upsert(toPaths)
  }

  saveMemory(input: MemoryInput): MemoryEntry & { created: boolean } {
    const now = Date.now()
    const tagsJson = JSON.stringify(input.tags)
    const contentHash = hashContent(input.content)
    const tier: MemoryTier = input.tier ?? (input.type === 'repository' ? 'semantic' : 'episodic')
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO memories (type, tier, content, tags, session_id, content_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(input.type, tier, input.content, tagsJson, input.sessionId, contentHash, now)

    if (result.changes === 0) {
      // NOTE: dedupe is on content_hash alone (v1 behavior) — a duplicate text saved
      // with a different type/tags/sessionId returns the EXISTING entry unchanged.
      const row = this.db
        .prepare('SELECT * FROM memories WHERE content_hash = ?')
        .get(contentHash) as MemoryRow | null
      if (row == null) {
        throw new Error(
          'saveMemory: insert ignored but no existing row for content_hash — invalid input?'
        )
      }
      return { ...rowToMemory(row), created: false }
    }

    return {
      id: Number(result.lastInsertRowid),
      type: input.type,
      tier,
      content: input.content,
      tags: input.tags,
      sessionId: input.sessionId,
      createdAt: new Date(now),
      lastAccessedAt: null,
      accessCount: 0,
      created: true,
    }
  }

  queryMemories(limit: number): MemoryEntry[] {
    const rows = this.db.prepare(
      'SELECT * FROM memories ORDER BY created_at DESC LIMIT ?'
    ).all(limit) as MemoryRow[]

    return rows.map(rowToMemory)
  }

  getMemoriesByIds(ids: number[]): MemoryEntry[] {
    if (ids.length === 0) return []
    const placeholders = ids.map(() => '?').join(',')
    const rows = this.db
      .prepare(`SELECT * FROM memories WHERE id IN (${placeholders})`)
      .all(...ids) as MemoryRow[]
    return rows.map(rowToMemory)
  }

  touchMemories(ids: number[]): void {
    if (ids.length === 0) return
    const placeholders = ids.map(() => '?').join(',')
    this.db
      .prepare(
        `UPDATE memories SET access_count = access_count + 1, last_accessed_at = ? WHERE id IN (${placeholders})`
      )
      .run(Date.now(), ...ids)
  }

  setMemoryTier(id: number, tier: MemoryTier): void {
    this.db.prepare('UPDATE memories SET tier = ? WHERE id = ?').run(tier, id)
  }

  deleteMemories(ids: number[]): void {
    if (ids.length === 0) return
    const placeholders = ids.map(() => '?').join(',')
    const run = this.db.transaction(() => {
      this.db
        .prepare(`DELETE FROM embeddings WHERE entity_type = 'memory' AND entity_id IN (${placeholders})`)
        .run(...ids)
      this.db.prepare(`DELETE FROM memories WHERE id IN (${placeholders})`).run(...ids)
    })
    run()
    const index = this.vectorIndexes.get('memory')
    if (index) {
      for (const id of ids) index.remove(id)
    }
  }

  getMemoriesMissingEmbeddings(limit: number): MemoryEntry[] {
    const rows = this.db
      .prepare(`
        SELECT m.* FROM memories m
        LEFT JOIN embeddings e ON e.entity_id = m.id AND e.entity_type = 'memory'
        WHERE e.id IS NULL
        ORDER BY m.created_at DESC
        LIMIT ?
      `)
      .all(limit) as MemoryRow[]
    return rows.map(rowToMemory)
  }

  upsertEmbedding(entityId: number, entityType: 'file' | 'memory', vector: number[] | Float32Array): void {
    const dims = vector.length
    const storedDims = this.getMeta('embedding_dims')
    if (storedDims === null) {
      this.setMeta('embedding_dims', String(dims))
    } else if (Number(storedDims) !== dims) {
      throw new Error(
        `Embedding dimension mismatch: index has ${storedDims}, got ${dims}. ` +
          `The embedding model changed — clear embeddings and reindex.`
      )
    }
    this.db.prepare(`
      INSERT INTO embeddings (entity_id, entity_type, vector)
      VALUES (?, ?, ?)
      ON CONFLICT(entity_id, entity_type) DO UPDATE SET vector = excluded.vector
    `).run(entityId, entityType, vectorToBuffer(vector))

    const index = this.vectorIndexes.get(entityType)
    if (index) {
      const f32 = vector instanceof Float32Array ? vector : new Float32Array(vector)
      index.add(entityId, f32)
    }
  }

  hasEmbedding(entityId: number, entityType: 'file' | 'memory'): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM embeddings WHERE entity_id = ? AND entity_type = ?')
      .get(entityId, entityType)
    return row != null
  }

  getAllEmbeddings(entityType: 'file' | 'memory'): EmbeddingRecord[] {
    const rows = this.db.prepare(
      'SELECT entity_id, entity_type, vector FROM embeddings WHERE entity_type = ?'
    ).all(entityType) as EmbeddingRow[]

    return rows.map((row) => ({
      entityId: row.entity_id,
      entityType: row.entity_type as EmbeddingRecord['entityType'],
      vector: Array.from(uint8ArrayToVector(row.vector)),
    }))
  }

  getEmbedding(entityId: number, entityType: 'file' | 'memory'): Float32Array | null {
    const row = this.db
      .prepare('SELECT vector FROM embeddings WHERE entity_id = ? AND entity_type = ?')
      .get(entityId, entityType) as { vector: Uint8Array } | undefined
    if (!row) return null
    return uint8ArrayToVector(row.vector)
  }

  getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row?.value ?? null
  }

  setMeta(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO meta (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value)
  }

  private ensureVectorIndex(entityType: 'file' | 'memory'): VectorIndex | null {
    const existing = this.vectorIndexes.get(entityType)
    if (existing) return existing
    const dims = this.getMeta('embedding_dims')
    if (dims === null) return null

    const rows = this.db.prepare(
      'SELECT entity_id, vector FROM embeddings WHERE entity_type = ?'
    ).all(entityType) as Array<{ entity_id: number; vector: Uint8Array }>

    const dimCount = Number(dims)
    const vectors = rows.map((row) => ({ id: row.entity_id, vec: uint8ArrayToVector(row.vector) }))

    // Corpus mean as quantization center — anisotropic embeddings (nonzero
    // mean direction) separate poorly under raw sign bits. Entries added
    // incrementally after this build quantize against the build-time mean;
    // the drift is acceptable because the index is rebuilt every process start.
    const mean = new Float32Array(dimCount)
    if (vectors.length > 0) {
      for (const { vec } of vectors) {
        for (let i = 0; i < dimCount; i++) mean[i] = mean[i]! + vec[i]!
      }
      for (let i = 0; i < dimCount; i++) mean[i] = mean[i]! / vectors.length
    }

    const index = new VectorIndex(dimCount, mean)
    for (const { id, vec } of vectors) {
      index.add(id, vec)
    }
    this.vectorIndexes.set(entityType, index)
    return index
  }

  /**
   * Hamming pre-filter over the in-RAM quantized index, then exact cosine
   * re-rank over full vectors loaded from SQLite. Returns topK, highest first.
   */
  searchSimilar(
    entityType: 'file' | 'memory',
    queryVector: number[] | Float32Array,
    topK: number,
    candidateK = 100
  ): Array<{ entityId: number; similarity: number }> {
    const index = this.ensureVectorIndex(entityType)
    if (!index || index.size === 0) return []

    const query = queryVector instanceof Float32Array ? queryVector : new Float32Array(queryVector)
    const candidateIds = index.candidates(query, Math.max(candidateK, topK))
    if (candidateIds.length === 0) return []

    const placeholders = candidateIds.map(() => '?').join(',')
    const rows = this.db.prepare(
      `SELECT entity_id, vector FROM embeddings WHERE entity_type = ? AND entity_id IN (${placeholders})`
    ).all(entityType, ...candidateIds) as Array<{ entity_id: number; vector: Uint8Array }>

    return rows
      .map((row) => ({
        entityId: row.entity_id,
        similarity: cosineStrict(query, uint8ArrayToVector(row.vector)),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK)
  }

  hasAnyEmbeddings(entityType: 'file' | 'memory'): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM embeddings WHERE entity_type = ? LIMIT 1')
      .get(entityType)
    return row != null
  }

  /** Drops all embeddings (both types) and the dimension marker. Used on embedding-model swap. */
  clearEmbeddings(): void {
    this.db.prepare('DELETE FROM embeddings').run()
    this.db.prepare("DELETE FROM meta WHERE key = 'embedding_dims'").run()
    this.vectorIndexes.clear()
  }

  /** Blanks all file hashes so the next indexer run re-processes (and re-embeds) every file. */
  invalidateFileHashes(): void {
    this.db.prepare("UPDATE files SET hash = ''").run()
  }

  close(): void {
    this.db.close()
  }
}
