import { afterAll, describe, expect, test } from "bun:test"
import { probeModel } from "../src/probe"

type FakeBehavior = {
  reasoningField?: boolean
  toolCalls?: boolean
  parallel?: boolean
}

function sse(events: object[]): Response {
  const lines = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n"
  return new Response(lines, { headers: { "content-type": "text/event-stream" } })
}

function chunk(delta: object, finish: string | null = null) {
  return { choices: [{ delta, finish_reason: finish }] }
}

function makeFakeOllama(behavior: FakeBehavior) {
  return Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as { tools?: unknown[] }
      const toolCount = body.tools?.length ?? 0
      if (toolCount === 1 && behavior.toolCalls) {
        return sse([chunk({ tool_calls: [{ index: 0, function: { name: "echo" } }] }, "tool_calls")])
      }
      if (toolCount === 2 && behavior.parallel) {
        return sse([
          chunk({
            tool_calls: [
              { index: 0, function: { name: "time_now" } },
              { index: 1, function: { name: "date_today" } },
            ],
          }, "tool_calls"),
        ])
      }
      if (toolCount > 0) {
        return sse([chunk({ content: "I cannot do that" }, "stop")])
      }
      if (behavior.reasoningField) {
        return sse([chunk({ reasoning: "thinking..." }), chunk({ content: "hi" }, "stop")])
      }
      return sse([chunk({ content: "hi" }, "stop")])
    },
  })
}

const servers: ReturnType<typeof Bun.serve>[] = []
afterAll(() => servers.forEach((s) => s.stop(true)))

function url(s: ReturnType<typeof Bun.serve>) {
  servers.push(s)
  return `http://localhost:${s.port}`
}

describe("probeModel", () => {
  test("detects streaming with no reasoning and no tools", async () => {
    const r = await probeModel(url(makeFakeOllama({})), "fake")
    expect(r.streaming).toBe(true)
    expect(r.reasoningStyle).toBe("none")
    expect(r.toolCalling).toBe(false)
    expect(r.parallelToolCalls).toBe(false)
  })

  test("detects reasoning-field style", async () => {
    const r = await probeModel(url(makeFakeOllama({ reasoningField: true })), "fake")
    expect(r.reasoningStyle).toBe("reasoning-field")
  })

  test("detects tool calling without parallel", async () => {
    const r = await probeModel(url(makeFakeOllama({ toolCalls: true })), "fake")
    expect(r.toolCalling).toBe(true)
    expect(r.parallelToolCalls).toBe(false)
  })

  test("detects parallel tool calls", async () => {
    const r = await probeModel(url(makeFakeOllama({ toolCalls: true, parallel: true })), "fake")
    expect(r.parallelToolCalls).toBe(true)
  })

  test("reports error when server unreachable", async () => {
    const r = await probeModel("http://localhost:1", "fake", 1500)
    expect(r.streaming).toBe(false)
    expect(r.error).toBeDefined()
  })
})
