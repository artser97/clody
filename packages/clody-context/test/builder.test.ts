import { describe, expect, test } from "bun:test"
import { ContextBuilder } from "../src/builder"

const memoryStub = {
  query: async () => [{ id: 1, type: "repository", tier: "semantic", content: "uses bun test", tags: [], createdAt: new Date() }],
  inject: (entries: Array<{ content: string }>) => entries.map((e) => `- ${e.content}`).join("\n"),
  captureFromMessages: async () => {},
}

const retrievalStub = {
  query: async () => ({
    chunks: [
      { filePath: "src/auth.ts", snippet: "function login() {}", reason: "symbol-match", relevanceScore: 0.9 },
    ],
    totalTokens: 12,
    durationMs: 1,
  }),
}

function build(maxTokens: number, baseTokens = 0) {
  const builder = new ContextBuilder(retrievalStub as never, memoryStub as never, maxTokens)
  return builder.build(
    [{ role: "user", content: "fix the login bug in auth" }],
    { id: "s1", workingDirectory: "/tmp/p" },
    baseTokens,
  )
}

describe("ContextBuilder", () => {
  test("injects memory and code sections within budget", async () => {
    const ctx = await build(32_000)
    expect(ctx.systemPromptPrefix).toContain("uses bun test")
    expect(ctx.systemPromptPrefix).toContain("src/auth.ts")
    expect(ctx.chunksUsed).toBe(1)
    expect(ctx.memoriesUsed).toBe(1)
    expect(ctx.estimatedTokens).toBeGreaterThan(0)
  })

  test("returns empty prefix when remaining budget is below the minimum", async () => {
    // base eats nearly everything: remaining < MIN_INJECTION_TOKENS (200)
    const ctx = await build(4_000, 3_900)
    expect(ctx.systemPromptPrefix).toBe("")
    expect(ctx.chunksUsed).toBe(0)
  })
})
