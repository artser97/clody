import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildClodyContext, __resetBridgeForTests, type HistoryEntry } from "../src/bridge"

const servers: ReturnType<typeof Bun.serve>[] = []
afterAll(() => servers.forEach((s) => s.stop(true)))

function fakeEmbedServer() {
  const s = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as { input: string[] }
      return Response.json({ embeddings: body.input.map(() => [0.5, 0.5]) })
    },
  })
  servers.push(s)
  return `http://localhost:${s.port}`
}

describe("buildClodyContext", () => {
  test("indexes the project on first call and returns a budgeted context block", async () => {
    const project = mkdtempSync(join(tmpdir(), "clody-bridge-"))
    writeFileSync(join(project, "auth.ts"), "export function login() { return true }\n")
    const home = mkdtempSync(join(tmpdir(), "clody-home-"))
    __resetBridgeForTests({
      ollamaUrl: fakeEmbedServer(),
      embeddingModel: "fake",
      maxContextTokens: 32_000,
      stateDir: home,
    })

    const block = await buildClodyContext({
      queryText: "fix the login function",
      directory: project,
      sessionID: "s1",
      baseTokens: 1000,
    })
    expect(block).toBeDefined()
    expect(block!).toContain("auth.ts")
  })

  test("returns undefined instead of throwing when everything is broken", async () => {
    __resetBridgeForTests({
      ollamaUrl: "http://localhost:1", // unreachable
      embeddingModel: "fake",
      maxContextTokens: 32_000,
      stateDir: mkdtempSync(join(tmpdir(), "clody-home2-")),
    })
    const block = await buildClodyContext({
      queryText: "anything",
      directory: "/nonexistent/path/zzz",
      sessionID: "s1",
      baseTokens: 0,
    })
    expect(block).toBeUndefined() // fail-soft: context layer must never break the chat
  })
})

function skillFixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "clody-skfix-"))
  mkdirSync(join(dir, "style"))
  writeFileSync(
    join(dir, "style", "SKILL.md"),
    `---\nname: style\ndescription: Project code style rules\n---\nUse two-space indent. Never use semicolons.\n`,
  )
  return dir
}

describe("buildClodyContext skills", () => {
  test("auto-routes and injects skill bodies above threshold", async () => {
    const project = mkdtempSync(join(tmpdir(), "clody-bridge-sk-"))
    writeFileSync(join(project, "a.ts"), "export const a = 1\n")
    __resetBridgeForTests({
      ollamaUrl: fakeEmbedServer(),
      embeddingModel: "fake",
      maxContextTokens: 32_000,
      stateDir: mkdtempSync(join(tmpdir(), "clody-home-sk-")),
      skillDirs: [skillFixtureDir()],
      skillThreshold: 0.5,
    })
    const block = await buildClodyContext({
      queryText: "follow the style rules",
      directory: project,
      sessionID: "s1",
      baseTokens: 1000,
    })
    expect(block).toBeDefined()
    expect(block!).toContain("Never use semicolons")
    expect(block!).toContain("## Active Skills")
  })

  test("CLODY_SKILLS=none disables skills entirely", async () => {
    process.env["CLODY_SKILLS"] = "none"
    try {
      const project = mkdtempSync(join(tmpdir(), "clody-bridge-sk2-"))
      writeFileSync(join(project, "a.ts"), "export const a = 1\n")
      __resetBridgeForTests({
        ollamaUrl: fakeEmbedServer(),
        embeddingModel: "fake",
        maxContextTokens: 32_000,
        stateDir: mkdtempSync(join(tmpdir(), "clody-home-sk2-")),
        skillDirs: [skillFixtureDir()],
        skillThreshold: 0.5,
      })
      const block = await buildClodyContext({
        queryText: "follow the style rules",
        directory: project,
        sessionID: "s1",
        baseTokens: 1000,
      })
      expect(block ?? "").not.toContain("Never use semicolons")
    } finally {
      delete process.env["CLODY_SKILLS"]
    }
  })

  test("CLODY_SKILLS=style forces the named skill without routing", async () => {
    process.env["CLODY_SKILLS"] = "style"
    try {
      const project = mkdtempSync(join(tmpdir(), "clody-bridge-sk3-"))
      writeFileSync(join(project, "a.ts"), "export const a = 1\n")
      __resetBridgeForTests({
        ollamaUrl: fakeEmbedServer(),
        embeddingModel: "fake",
        maxContextTokens: 32_000,
        stateDir: mkdtempSync(join(tmpdir(), "clody-home-sk3-")),
        skillDirs: [skillFixtureDir()],
        skillThreshold: 0.99,
      })
      const block = await buildClodyContext({
        queryText: "anything at all",
        directory: project,
        sessionID: "s1",
        baseTokens: 1000,
      })
      expect(block!).toContain("Never use semicolons")
    } finally {
      delete process.env["CLODY_SKILLS"]
    }
  })
})

describe("buildClodyContext history capture", () => {
  test("error tool_results in history become queryable failure memories", async () => {
    const project = mkdtempSync(join(tmpdir(), "clody-bridge-hist-"))
    writeFileSync(join(project, "a.ts"), "export const a = 1\n")
    const stateDir = mkdtempSync(join(tmpdir(), "clody-home-hist-"))
    __resetBridgeForTests({
      ollamaUrl: fakeEmbedServer(),
      embeddingModel: "fake",
      maxContextTokens: 32_000,
      stateDir,
    })
    await buildClodyContext({
      queryText: "why did it fail?",
      directory: project,
      sessionID: "s-hist",
      baseTokens: 1000,
      history: [
        { role: "user", text: "run the build" },
        { role: "assistant", text: "Running it now." },
        { role: "user", toolError: "BUILD FAILED: cannot resolve module zlib-sync" },
      ],
    })
    await new Promise((r) => setTimeout(r, 300)) // capture is fire-and-forget
    __resetBridgeForTests({
      ollamaUrl: fakeEmbedServer(),
      embeddingModel: "fake",
      maxContextTokens: 32_000,
      stateDir,
    })
    const block = await buildClodyContext({
      queryText: "zlib-sync module problem",
      directory: project,
      sessionID: "s-hist2",
      baseTokens: 1000,
    })
    expect(block ?? "").toContain("zlib-sync")
  })
})
