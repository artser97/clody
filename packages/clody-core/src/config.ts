/**
 * ~/.clody/config.json — same file and shape as clody v1, minimal loader
 * without zod. Env overrides: CLODY_MODEL, CLODY_OLLAMA_URL.
 */
import { homedir } from "node:os"
import { join, dirname } from "node:path"
import { mkdir } from "node:fs/promises"
import type { ProbeResult } from "./probe"
import type { ReasoningStyle } from "./profiles"

export interface StoredProbe {
  streaming: boolean
  toolCalling: boolean
  parallelToolCalls: boolean
  reasoningStyle: ReasoningStyle
  probedAt: string
}

export interface ClodyConfig {
  model: string
  ollamaUrl: string
  maxContextTokens: number
  ramCeilingGB: number
  embeddingModel: string
  outputTokens: number
  skillThreshold: number
  judgeMode: "on" | "off" | "tui"
  /** Default per-task tool allowlist (sets CLODY_TOOLS). Empty = all tools. */
  tools: string[]
  /** Default skills loaded into context for the session (sets CLODY_SKILLS). Empty = none. */
  skills: string[]
  probes: Record<string, StoredProbe>
}

export const DEFAULT_CONFIG_PATH = join(homedir(), ".clody", "config.json")

/**
 * The tools clody-local exposes (mirrors the agent permission allowlist). The
 * selector offers these; exploration-first ordering so digit-picking the first
 * few yields a read-only set.
 */
export const CORE_TOOLS = ["read", "grep", "glob", "list", "edit", "write", "bash"] as const

const VALID_JUDGE_MODES = ["on", "off", "tui"] as const
type JudgeMode = (typeof VALID_JUDGE_MODES)[number]

function parseJudgeMode(value: unknown): JudgeMode {
  if (VALID_JUDGE_MODES.includes(value as JudgeMode)) return value as JudgeMode
  return "tui"
}

const DEFAULTS: ClodyConfig = {
  model: "gemma4:12b",
  ollamaUrl: "http://localhost:11434",
  maxContextTokens: 32000,
  ramCeilingGB: 24,
  embeddingModel: "nomic-embed-text",
  outputTokens: 8000,
  skillThreshold: 0.55,
  judgeMode: "tui",
  tools: [],
  skills: [],
  probes: {},
}

async function readRaw(path: string): Promise<Record<string, unknown>> {
  try {
    return (await Bun.file(path).json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

export async function loadClodyConfig(path = DEFAULT_CONFIG_PATH): Promise<ClodyConfig> {
  const raw = await readRaw(path)
  return {
    model: process.env["CLODY_MODEL"] ?? (raw["model"] as string) ?? DEFAULTS.model,
    ollamaUrl: process.env["CLODY_OLLAMA_URL"] ?? (raw["ollamaUrl"] as string) ?? DEFAULTS.ollamaUrl,
    maxContextTokens: (raw["maxContextTokens"] as number) ?? DEFAULTS.maxContextTokens,
    ramCeilingGB: (raw["ramCeilingGB"] as number) ?? DEFAULTS.ramCeilingGB,
    embeddingModel: (raw["embeddingModel"] as string) ?? DEFAULTS.embeddingModel,
    outputTokens: (raw["outputTokens"] as number) ?? DEFAULTS.outputTokens,
    skillThreshold: (raw["skillThreshold"] as number) ?? DEFAULTS.skillThreshold,
    judgeMode: parseJudgeMode(raw["judgeMode"] ?? DEFAULTS.judgeMode),
    tools: (raw["tools"] as string[]) ?? DEFAULTS.tools,
    skills: (raw["skills"] as string[]) ?? DEFAULTS.skills,
    probes: (raw["probes"] as Record<string, StoredProbe>) ?? {},
  }
}

export async function saveProbeResult(path: string, model: string, probe: ProbeResult): Promise<void> {
  const raw = await readRaw(path)
  const probes = (raw["probes"] as Record<string, unknown>) ?? {}
  raw["probes"] = {
    ...probes,
    [model]: {
      streaming: probe.streaming,
      toolCalling: probe.toolCalling,
      parallelToolCalls: probe.parallelToolCalls,
      reasoningStyle: probe.reasoningStyle,
      probedAt: new Date().toISOString(),
    },
  }
  await mkdir(dirname(path), { recursive: true })
  await Bun.write(path, JSON.stringify(raw, null, 2))
}

/** True if a clody config file exists at path. */
export async function configFileExists(path = DEFAULT_CONFIG_PATH): Promise<boolean> {
  return await Bun.file(path).exists()
}

/**
 * Merge a partial config into the raw file and write it (clody keys win).
 * Top-level keys are shallow-merged (new value replaces old), EXCEPT for
 * `probes` which is merged per-model so that writing one model's probe result
 * never drops another model's existing probe data.
 */
export async function saveClodyConfig(path: string, partial: Partial<ClodyConfig>): Promise<void> {
  const raw = await readRaw(path)
  const existingProbes = (raw["probes"] as Record<string, unknown>) ?? {}
  const merged = {
    ...raw,
    ...partial,
    ...(partial.probes ? { probes: { ...existingProbes, ...partial.probes } } : {}),
  }
  await mkdir(dirname(path), { recursive: true })
  await Bun.write(path, JSON.stringify(merged, null, 2))
}
