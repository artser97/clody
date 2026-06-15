import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SqliteStorage } from "../src/storage"
import { Indexer, parseTypeScript } from "../src/indexer"

describe("parseTypeScript", () => {
  test("extracts function and class symbols with positions", () => {
    const result = parseTypeScript(
      ["export function computeTotal(a: number) {", "  return a", "}", "class Cart {}", ""].join("\n"),
    )
    const names = result.symbols.map((s) => s.name)
    expect(names).toContain("computeTotal")
    expect(names).toContain("Cart")
    const fn = result.symbols.find((s) => s.name === "computeTotal")!
    expect(fn.line).toBe(1)
  })

  test("extracts import targets", () => {
    const result = parseTypeScript(`import { x } from "./other"\nimport y from "../lib/y"\n`)
    expect(result.imports).toContain("./other")
    expect(result.imports).toContain("../lib/y")
  })
})

describe("Indexer", () => {
  test("indexes a directory: files, symbols, snippets land in storage", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clody-idx-"))
    mkdirSync(join(dir, "src"))
    writeFileSync(join(dir, "src", "math.ts"), "export function add(a: number, b: number) { return a + b }\n")
    writeFileSync(join(dir, "src", "skip.md"), "# not code\n")
    // DB outside the indexed dir so the walker doesn't see it
    const dbDir = mkdtempSync(join(tmpdir(), "clody-idx-db-"))
    const db = new SqliteStorage(join(dbDir, "t.db"))
    const indexer = new Indexer(db, null)
    // v1 IndexOptions uses workingDirectory, not rootDir
    const result = await indexer.index({ workingDirectory: dir })
    expect(result.filesIndexed).toBeGreaterThan(0)
    // v1 stores relative paths so getFile uses relPath "src/math.ts"
    expect(db.getFile("src/math.ts")).not.toBeNull()
    expect(db.searchSymbolsByName("add").length).toBeGreaterThan(0)
  })

  test("re-index skips unchanged files (hash check)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clody-idx2-"))
    writeFileSync(join(dir, "a.ts"), "export const a = 1\n")
    const dbDir = mkdtempSync(join(tmpdir(), "clody-idx2-db-"))
    const db = new SqliteStorage(join(dbDir, "t.db"))
    const indexer = new Indexer(db, null)
    await indexer.index({ workingDirectory: dir })
    const second = await indexer.index({ workingDirectory: dir })
    expect(second.filesIndexed).toBe(0)
  })
})
