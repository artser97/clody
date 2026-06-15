/**
 * Embedding router: cosine similarity between the task text and skill
 * descriptions. Description vectors are cached on disk keyed by content hash
 * so steady-state routing costs one embed call (the query).
 */
import { createHash } from "node:crypto"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { cosineSimilarity } from "../retrieval"
import type { Embedder } from "../types"
import type { SkillInfo } from "./discovery"

export interface SkillMatch {
  skill: SkillInfo
  score: number
}

export interface RouteOptions {
  limit: number
  threshold: number
}

/** Drop candidates more than MARGIN below the top score after threshold filter */
const MARGIN = 0.08

export class SkillRouter {
  constructor(
    private readonly embedder: Embedder,
    private readonly cachePath: string,
    private readonly cacheKeySalt: string = "",
  ) {}

  private cacheKey(description: string): string {
    return hash(this.cacheKeySalt + " " + description)
  }

  private async loadCache(): Promise<Record<string, number[]>> {
    try {
      return (await Bun.file(this.cachePath).json()) as Record<string, number[]>
    } catch {
      return {}
    }
  }

  async route(queryText: string, skills: SkillInfo[], opts: RouteOptions): Promise<SkillMatch[]> {
    if (skills.length === 0 || queryText.trim().length === 0) return []
    const cache = await this.loadCache()
    const missing = skills.filter((s) => !cache[this.cacheKey(s.description)])
    if (missing.length > 0) {
      const { embeddings } = await this.embedder.embed(missing.map((s) => s.description))
      missing.forEach((s, i) => {
        if (embeddings[i]) cache[this.cacheKey(s.description)] = embeddings[i]!
      })
      mkdirSync(dirname(this.cachePath), { recursive: true })
      await Bun.write(this.cachePath, JSON.stringify(cache))
    }
    const { embeddings: queryVecs } = await this.embedder.embed([queryText])
    const queryVec = queryVecs[0]
    if (!queryVec) return []
    // Find skills whose cached dimension doesn't match the query (stale model)
    const dimMismatch = skills.filter((s) => {
      const vec = cache[this.cacheKey(s.description)]
      return vec !== undefined && vec.length !== queryVec.length
    })
    if (dimMismatch.length > 0) {
      // Re-embed with the current model to get correct dimensions
      const { embeddings } = await this.embedder.embed(dimMismatch.map((s) => s.description))
      dimMismatch.forEach((s, i) => {
        if (embeddings[i]) cache[this.cacheKey(s.description)] = embeddings[i]!
      })
      mkdirSync(dirname(this.cachePath), { recursive: true })
      await Bun.write(this.cachePath, JSON.stringify(cache))
    }
    const sorted = skills
      .map((skill) => {
        const vec = cache[this.cacheKey(skill.description)]
        if (!vec || vec.length !== queryVec.length) return undefined
        return { skill, score: cosineSimilarity(queryVec, vec) }
      })
      .filter((m): m is SkillMatch => m !== undefined && m.score >= opts.threshold)
      .toSorted((a, b) => b.score - a.score)
    return sorted
      .filter((m, _, arr) => arr.length === 0 || arr[0]!.score - m.score <= MARGIN)
      .slice(0, opts.limit)
  }
}

function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}
