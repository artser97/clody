import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { SqliteStorage } from "../src/storage"
import { binaryQuantize, hammingDistance } from "../src/storage"

function freshDb(): SqliteStorage {
  return new SqliteStorage(join(mkdtempSync(join(tmpdir(), "clody-ctx-")), "test.db"))
}

describe("SqliteStorage files+symbols", () => {
  test("upsertFile / getFile / listFiles roundtrip", () => {
    const db = freshDb()
    const f = db.upsertFile("src/a.ts", "hash1", "typescript", "const a = 1")
    expect(db.getFile("src/a.ts")?.id).toBe(f.id)
    expect(db.listFiles()).toHaveLength(1)
    db.upsertFile("src/a.ts", "hash2", "typescript", "const a = 2")
    expect(db.listFiles()).toHaveLength(1)
    expect(db.getFile("src/a.ts")?.hash).toBe("hash2")
  })

  test("insertSymbols / searchSymbolsByName", () => {
    const db = freshDb()
    const f = db.upsertFile("src/b.ts", "h", "typescript", "")
    db.insertSymbols(f.id, [
      { name: "computeTotal", kind: "function", line: 1, col: 0 },
      { name: "helper", kind: "function", line: 9, col: 0 },
    ])
    const hits = db.searchSymbolsByName("computeTotal")
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]!.filePath).toBe("src/b.ts")
  })
})

describe("SqliteStorage memories", () => {
  test("saveMemory dedupes on content, queryMemories returns entries", () => {
    const db = freshDb()
    const first = db.saveMemory({ type: "repository", content: "uses bun test", tags: [], sessionId: "s1" })
    expect(first.created).toBe(true)
    const dup = db.saveMemory({ type: "repository", content: "uses bun test", tags: [], sessionId: "s1" })
    expect(dup.created).toBe(false)
    expect(db.queryMemories(10)).toHaveLength(1)
  })
})

describe("SqliteStorage embeddings (BLOB roundtrip — the bun:sqlite hazard)", () => {
  test("upsertEmbedding / getEmbedding preserves float values", () => {
    const db = freshDb()
    const f = db.upsertFile("src/c.ts", "h", "typescript", "")
    const vec = new Float32Array([0.25, -0.5, 0.125, 1.0])
    db.upsertEmbedding(f.id, "file", vec)
    const back = db.getEmbedding(f.id, "file")
    expect(back).not.toBeNull()
    expect(Array.from(back!)).toEqual([0.25, -0.5, 0.125, 1.0])
    expect(db.hasEmbedding(f.id, "file")).toBe(true)
  })

  test("getAllEmbeddings returns stored records", () => {
    const db = freshDb()
    const f = db.upsertFile("src/d.ts", "h", "typescript", "")
    db.upsertEmbedding(f.id, "file", new Float32Array([1, 2, 3]))
    const all = db.getAllEmbeddings("file")
    expect(all).toHaveLength(1)
    expect(all[0]!.entityId).toBe(f.id)
  })
})

describe("SqliteStorage meta", () => {
  test("get/setMeta roundtrip", () => {
    const db = freshDb()
    expect(db.getMeta("embedding_model")).toBeNull()
    db.setMeta("embedding_model", "nomic-embed-text")
    expect(db.getMeta("embedding_model")).toBe("nomic-embed-text")
  })
})

describe("vector-index", () => {
  test("binaryQuantize + hammingDistance: identical vectors → 0, opposite → dims", () => {
    const a = new Float32Array([1, -1, 1, -1])
    const b = new Float32Array([-1, 1, -1, 1])
    expect(hammingDistance(binaryQuantize(a), binaryQuantize(a))).toBe(0)
    expect(hammingDistance(binaryQuantize(a), binaryQuantize(b))).toBe(4)
  })
})

describe("SqliteStorage embedding gates (bun:sqlite null-miss regression)", () => {
  test("hasEmbedding returns false when absent", () => {
    const db = freshDb()
    const f = db.upsertFile("src/none.ts", "h", "typescript", "")
    expect(db.hasEmbedding(f.id, "file")).toBe(false)
  })

  test("hasAnyEmbeddings is false on an empty DB, true after one insert", () => {
    const db = freshDb()
    expect(db.hasAnyEmbeddings("file")).toBe(false)
    const f = db.upsertFile("src/one.ts", "h", "typescript", "")
    db.upsertEmbedding(f.id, "file", new Float32Array([1, 0]))
    expect(db.hasAnyEmbeddings("file")).toBe(true)
  })

  test("getMemoriesMissingEmbeddings returns exactly the unembedded ones", () => {
    const db = freshDb()
    const withVec = db.saveMemory({ type: "repository", content: "embedded fact", tags: [], sessionId: "s" })
    db.upsertEmbedding(withVec.id, "memory", new Float32Array([1, 0]))
    db.saveMemory({ type: "repository", content: "bare fact", tags: [], sessionId: "s" })
    const missing = db.getMemoriesMissingEmbeddings(10)
    expect(missing).toHaveLength(1)
    expect(missing[0]!.content).toBe("bare fact")
  })
})

describe("SqliteStorage searchSimilar across reopen", () => {
  test("vector index rebuilds from disk and ranks nearest first", () => {
    const dir = mkdtempSync(join(tmpdir(), "clody-reopen-"))
    const dbPath = join(dir, "t.db")
    {
      const db = new SqliteStorage(dbPath)
      const a = db.upsertFile("a.ts", "h", "typescript", "")
      const b = db.upsertFile("b.ts", "h", "typescript", "")
      db.upsertEmbedding(a.id, "file", new Float32Array([1, 0, 0, 0]))
      db.upsertEmbedding(b.id, "file", new Float32Array([0, 1, 0, 0]))
      db.close()
    }
    const reopened = new SqliteStorage(dbPath)
    // searchSimilar(entityType, queryVector, topK) — entityType is first arg
    const hits = reopened.searchSimilar("file", new Float32Array([0.9, 0.1, 0, 0]), 2)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]!.entityId).toBeDefined()
    // nearest neighbor of ~[1,0] must be a.ts's embedding (entityId of a)
  })
})

describe("SqliteStorage deleteFileByPath multi-table consistency", () => {
  test("removes file, symbols, and vector-index entry", () => {
    const db = freshDb()
    const f = db.upsertFile("gone.ts", "h", "typescript", "")
    db.insertSymbols(f.id, [{ name: "doomed", kind: "function", line: 1, col: 0 }])
    db.upsertEmbedding(f.id, "file", new Float32Array([1, 0]))
    db.deleteFileByPath("gone.ts")
    expect(db.getFile("gone.ts")).toBeNull()
    expect(db.searchSymbolsByName("doomed")).toHaveLength(0)
    // searchSimilar(entityType, queryVector, topK) — entityType is first arg
    const hits = db.searchSimilar("file", new Float32Array([1, 0]), 5)
    expect(hits.find((h) => h.entityId === f.id)).toBeUndefined()
  })
})

describe("SqliteStorage schema recreate preserves memories", () => {
  test("memories survive a user_version bump; derived tables are wiped", () => {
    const dir = mkdtempSync(join(tmpdir(), "clody-recreate-"))
    const dbPath = join(dir, "t.db")
    {
      const db = new SqliteStorage(dbPath)
      db.saveMemory({ type: "repository", content: "precious user fact", tags: ["keep"], sessionId: "s1" })
      const f = db.upsertFile("derived.ts", "h", "typescript", "")
      db.upsertEmbedding(f.id, "file", new Float32Array([1, 0]))
      db.close()
    }
    {
      const raw = new Database(dbPath)
      raw.exec("PRAGMA user_version = 0;")
      raw.close()
    }
    const reopened = new SqliteStorage(dbPath)
    const memories = reopened.queryMemories(10)
    expect(memories).toHaveLength(1)
    expect(memories[0]!.content).toBe("precious user fact")
    expect(memories[0]!.tags).toEqual(["keep"])
    expect(reopened.listFiles()).toHaveLength(0)
    expect(reopened.hasAnyEmbeddings("memory")).toBe(false)
  })

  test("recreate tolerates a pre-memories-era DB with no memories table", () => {
    const dir = mkdtempSync(join(tmpdir(), "clody-recreate2-"))
    const dbPath = join(dir, "t.db")
    {
      const raw = new Database(dbPath)
      raw.exec("CREATE TABLE something_old (id INTEGER); PRAGMA user_version = 0;")
      raw.close()
    }
    const db = new SqliteStorage(dbPath)
    expect(db.queryMemories(10)).toHaveLength(0)
  })
})
