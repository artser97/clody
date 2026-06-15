import { afterAll, describe, expect, test } from "bun:test"
import { OllamaEmbedder } from "../src/embedder"

const servers: ReturnType<typeof Bun.serve>[] = []
afterAll(() => servers.forEach((s) => s.stop(true)))

describe("OllamaEmbedder", () => {
  test("posts to /api/embed and returns vectors per input", async () => {
    let seenBody: unknown
    const s = Bun.serve({
      port: 0,
      async fetch(req) {
        seenBody = await req.json()
        return Response.json({ embeddings: [[0.1, 0.2], [0.3, 0.4]] })
      },
    })
    servers.push(s)
    const embedder = new OllamaEmbedder(`http://localhost:${s.port}`, "nomic-embed-text")
    const out = await embedder.embed(["hello", "world"])
    expect(out.embeddings).toEqual([[0.1, 0.2], [0.3, 0.4]])
    expect((seenBody as { model: string }).model).toBe("nomic-embed-text")
    expect((seenBody as { input: string[] }).input).toEqual(["hello", "world"])
  })

  test("circuit breaker: after 3 failures, embed short-circuits until cooldown", async () => {
    const s = Bun.serve({ port: 0, fetch: () => new Response("boom", { status: 500 }) })
    servers.push(s)
    const embedder = new OllamaEmbedder(`http://localhost:${s.port}`, "m", { failureThreshold: 3, cooldownMs: 60_000 })
    for (let i = 0; i < 3; i++) {
      await expect(embedder.embed(["x"])).rejects.toThrow()
    }
    // breaker now open: fails fast without hitting the server
    await expect(embedder.embed(["x"])).rejects.toThrow(/circuit/i)
  })

  test("half-open: after cooldown, ONE failure re-opens the breaker", async () => {
    const s = Bun.serve({ port: 0, fetch: () => new Response("boom", { status: 500 }) })
    servers.push(s)
    const embedder = new OllamaEmbedder(`http://localhost:${s.port}`, "m", { failureThreshold: 3, cooldownMs: 50 })
    for (let i = 0; i < 3; i++) await expect(embedder.embed(["x"])).rejects.toThrow()
    await expect(embedder.embed(["x"])).rejects.toThrow(/circuit/i) // open
    await new Promise((r) => setTimeout(r, 60)) // cooldown expires
    await expect(embedder.embed(["x"])).rejects.toThrow(/HTTP 500/) // one probe allowed
    await expect(embedder.embed(["x"])).rejects.toThrow(/circuit/i) // re-opened after ONE failure
  })
})
