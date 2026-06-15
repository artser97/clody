import { afterAll, describe, expect, test } from "bun:test"
import { isModelLoaded, readLoadedContextLength } from "../src/ollama"

const servers: ReturnType<typeof Bun.serve>[] = []
afterAll(() => servers.forEach((s) => s.stop(true)))

function fakeOllamaPs(models: Array<{ name: string; context_length?: number }>) {
  const s = Bun.serve({
    port: 0,
    fetch(req) {
      if (new URL(req.url).pathname === "/api/ps") {
        return Response.json({ models })
      }
      return new Response("not found", { status: 404 })
    },
  })
  servers.push(s)
  return `http://localhost:${s.port}`
}

describe("isModelLoaded (exact match — review fix d)", () => {
  test("matches the exact model name", async () => {
    const url = fakeOllamaPs([{ name: "gemma4:12b" }])
    expect(await isModelLoaded(url, "gemma4:12b")).toBe(true)
  })
  test("does NOT match a different size of the same family", async () => {
    const url = fakeOllamaPs([{ name: "gemma4:4b" }])
    expect(await isModelLoaded(url, "gemma4:12b")).toBe(false)
  })
  test("accepts the :latest alias for a bare model name", async () => {
    const url = fakeOllamaPs([{ name: "nomic-embed-text:latest" }])
    expect(await isModelLoaded(url, "nomic-embed-text")).toBe(true)
  })
})

describe("readLoadedContextLength (review fix c)", () => {
  test("returns the loaded model's context_length", async () => {
    const url = fakeOllamaPs([{ name: "gemma4:12b", context_length: 4096 }])
    expect(await readLoadedContextLength(url, "gemma4:12b")).toBe(4096)
  })
  test("returns null when model not loaded or field missing", async () => {
    expect(await readLoadedContextLength(fakeOllamaPs([]), "gemma4:12b")).toBeNull()
    expect(await readLoadedContextLength(fakeOllamaPs([{ name: "gemma4:12b" }]), "gemma4:12b")).toBeNull()
  })
})
