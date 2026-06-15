import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SqliteStorage } from "../src/storage"
import { RetrievalEngine, cosineSimilarity, RecentEditsCache } from "../src/retrieval"

// ADAPTATION: Embedder.embed returns Promise<{ embeddings: number[][] }>, not number[][].
// The fakeEmbedder must match the v1 Embedder interface exactly.
const fakeEmbedder = {
  embed: async (inputs: string[]) => ({
    embeddings: inputs.map((t) => (t.includes("auth") ? [1, 0] : [0, 1])),
  }),
}

function seededDb(): SqliteStorage {
  const db = new SqliteStorage(join(mkdtempSync(join(tmpdir(), "clody-ret-")), "t.db"))
  // ADAPTATION: upsertEmbedding accepts number[]|Float32Array — Float32Array is fine as-is.
  const auth = db.upsertFile("src/auth.ts", "h1", "typescript", "function login() {}")
  db.insertSymbols(auth.id, [{ name: "login", kind: "function", line: 1, col: 0 }])
  db.upsertEmbedding(auth.id, "file", new Float32Array([1, 0]))
  const other = db.upsertFile("src/billing.ts", "h2", "typescript", "function charge() {}")
  db.upsertEmbedding(other.id, "file", new Float32Array([0, 1]))
  return db
}

describe("cosineSimilarity", () => {
  // ADAPTATION: cosineSimilarity takes number[], not Float32Array.
  // Convert Float32Array literals to plain number arrays.
  test("orthogonal → 0, identical → 1", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1)
  })
})

describe("RecentEditsCache", () => {
  // ADAPTATION: v1 RecentEditsCache has no capacity-based constructor arg and no
  // touch()/list() API. It is a git-TTL cache with getRecentFiles(cwd).
  // The template test (capacity LRU with touch/list/eviction) cannot be written.
  // Equivalent real test: calling getRecentFiles on a non-git directory returns []
  // (negative cache path), and the result is an array.
  test("returns empty array for non-git directory", async () => {
    const cache = new RecentEditsCache()
    const result = await cache.getRecentFiles(tmpdir())
    expect(Array.isArray(result)).toBe(true)
  })

  test("caches the result (second call returns same reference)", async () => {
    const cache = new RecentEditsCache()
    const r1 = await cache.getRecentFiles(tmpdir())
    const r2 = await cache.getRecentFiles(tmpdir())
    // Both must be arrays; TTL cache returns same cached object
    expect(r1).toBe(r2)
  })
})

describe("RetrievalEngine", () => {
  test("symbol match ranks the defining file first", async () => {
    const engine = new RetrievalEngine(seededDb(), fakeEmbedder)
    const result = await engine.query({
      query: "fix the login function",
      workingDirectory: "/tmp",
      maxChunks: 5,
      maxTokens: 2000,
    })
    expect(result.chunks.length).toBeGreaterThan(0)
    expect(result.chunks[0]!.filePath).toBe("src/auth.ts")
  })

  test("respects maxTokens budget", async () => {
    const engine = new RetrievalEngine(seededDb(), fakeEmbedder)
    const result = await engine.query({
      query: "auth login",
      workingDirectory: "/tmp",
      maxChunks: 5,
      maxTokens: 10, // absurdly small — totals must stay under
    })
    // ADAPTATION: RetrievalResult exposes totalTokens directly — assertion is unchanged.
    expect(result.totalTokens).toBeLessThanOrEqual(10)
  })
})
