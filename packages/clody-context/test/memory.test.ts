import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SqliteStorage } from "../src/storage"
import { MemoryEngine } from "../src/memory"

const fakeEmbedder = {
  embed: async (inputs: string[]) => ({ embeddings: inputs.map(() => [0.5, 0.5]) }),
}

function fresh(): MemoryEngine {
  const db = new SqliteStorage(join(mkdtempSync(join(tmpdir(), "clody-mem-")), "t.db"))
  return new MemoryEngine(db, fakeEmbedder)
}

describe("MemoryEngine", () => {
  test("save then query returns the memory", async () => {
    const mem = fresh()
    await mem.save({ type: "repository", content: "project uses bun test", tags: ["testing"], sessionId: "s1" })
    const hits = await mem.query("how do tests run", 5, "s1")
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]!.content).toContain("bun test")
  })

  test("inject renders entries as a bulleted block", async () => {
    const mem = fresh()
    await mem.save({ type: "repository", content: "gateway port is 4000", tags: [], sessionId: "s1" })
    const hits = await mem.query("port", 5, "s1")
    const block = mem.inject(hits)
    expect(block).toContain("gateway port is 4000")
    expect(block).toContain("-")
  })

  test("captureFromMessages stores error learnings from tool_result blocks", async () => {
    const mem = fresh()
    await mem.captureFromMessages(
      [
        { role: "user", content: "run the tests" },
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "t1", name: "bash", input: { command: "bun test" } },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "t1", content: "FAIL: better-sqlite3 not found", is_error: true },
          ],
        },
      ],
      "s2",
    )
    const hits = await mem.query("better-sqlite3", 5, "s2")
    expect(hits.length).toBeGreaterThan(0)
  })
})
