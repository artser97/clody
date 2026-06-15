/**
 * Embedder over Ollama /api/embed with a small circuit breaker: after N
 * consecutive failures the context layer goes keyword-only for the cooldown
 * instead of stacking timeouts (v1 gateway behavior, inlined).
 */
import type { Embedder } from "./types"

export interface BreakerOptions {
  failureThreshold: number
  cooldownMs: number
}

export class OllamaEmbedder implements Embedder {
  private failures = 0
  private openedAt = 0

  constructor(
    private readonly ollamaUrl: string,
    private readonly model: string,
    private readonly breaker: BreakerOptions = { failureThreshold: 3, cooldownMs: 60_000 },
  ) {}

  async embed(inputs: string[]): Promise<{ embeddings: number[][] }> {
    if (this.failures >= this.breaker.failureThreshold) {
      if (Date.now() - this.openedAt < this.breaker.cooldownMs) {
        throw new Error("embedder circuit open — keyword-only retrieval until cooldown")
      }
      this.failures = this.breaker.failureThreshold - 1 // half-open: one strike only
    }
    try {
      const res = await fetch(`${this.ollamaUrl}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, input: inputs }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) throw new Error(`embed failed: HTTP ${res.status}`)
      const data = (await res.json()) as { embeddings: number[][] }
      this.failures = 0
      return { embeddings: data.embeddings }
    } catch (err) {
      this.failures++
      if (this.failures >= this.breaker.failureThreshold) this.openedAt = Date.now()
      throw err
    }
  }
}
