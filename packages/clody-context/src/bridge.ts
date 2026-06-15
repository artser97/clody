/**
 * Fail-soft facade between opencode's prompt assembly and the clody context
 * engine. Lazy singletons per (stateDir, directory); one ensureIndexed per
 * directory per process. Any error → undefined (chat must never break).
 */
import { createHash } from "node:crypto"
import { homedir } from "node:os"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { SqliteStorage } from "./storage"
import { Indexer } from "./indexer"
import { RetrievalEngine } from "./retrieval"
import { MemoryEngine } from "./memory"
import { ContextBuilder } from "./builder"
import { OllamaEmbedder } from "./embedder"
import { scanSkills, SkillRouter, DEFAULT_SKILL_DIRS } from "./skills"

export interface BridgeConfig {
  ollamaUrl: string
  embeddingModel: string
  maxContextTokens: number
  stateDir: string // dir holding per-project DBs (default ~/.clody/ctx)
  skillDirs?: string[] // default: ~/.config/clody/skills, ~/.config/opencode/skills, ~/.claude/skills
  skillThreshold?: number // default 0.55
}

/** One simplified history entry from the host session. `toolError` marks a
 *  failed tool result; it is mapped to a v1 tool_result block so the memory
 *  engine's failure-capture path sees it. */
export interface HistoryEntry {
  role: "user" | "assistant"
  text?: string
  toolError?: string
}

export interface BuildInput {
  queryText: string
  directory: string
  sessionID: string
  baseTokens: number
  history?: HistoryEntry[]
}

let config: BridgeConfig | undefined
const projects = new Map<string, { builder: ContextBuilder; indexed: Promise<unknown> }>()
let warnedOnce = false
let skillState: { router: SkillRouter; skills: Awaited<ReturnType<typeof scanSkills>> } | undefined
let loggedSkills: string | undefined
let skillBodyCache: { key: string; loaded: { name: string; body: string }[] } | undefined

/**
 * Stable, order-independent cache key for a resolved skill name set. Joins on a
 * NUL byte, which can't appear in a frontmatter `name:`, so distinct sets can't
 * collide (e.g. ["a b"] vs ["a","b"]).
 */
export function skillBodyCacheKey(names: string[]): string {
  return [...names].sort().join("\0")
}

const SKILL_BUDGET_RATIO = 0.4 // of the injection half of the window
const SKILL_LIMIT = 3

/**
 * clody: per-task tool selection. CLODY_TOOLS=comma,list restricts which tools
 * are advertised to the model on a turn, cutting tool-schema tokens on a small
 * local context window (the spike measured ~12.8k chars of schemas). Unset =>
 * all tools (no-op, no regression). Unknown names are ignored; if the selection
 * would leave zero tools we fall back to all (never strand the agent).
 */
export function selectActiveTools(available: string[]): string[] {
  const env = process.env["CLODY_TOOLS"]
  if (!env || !env.trim()) return available
  const wanted = new Set(
    env
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  )
  const selected = available.filter((t) => wanted.has(t))
  return selected.length > 0 ? selected : available
}

async function activeSkills(cfg: BridgeConfig, queryText: string): Promise<{ name: string; body: string }[]> {
  const env = process.env["CLODY_SKILLS"]
  if (env === "none") return []
  if (!skillState) {
    const skills = await scanSkills(cfg.skillDirs ?? [])
    const embedder = new OllamaEmbedder(cfg.ollamaUrl, cfg.embeddingModel)
    skillState = {
      router: new SkillRouter(embedder, join(cfg.stateDir, "skill-vectors.json"), cfg.embeddingModel),
      skills,
    }
  }
  let chosen: typeof skillState.skills
  if (env) {
    const wanted = new Set(env.split(",").map((s) => s.trim()).filter(Boolean))
    chosen = skillState.skills.filter((s) => wanted.has(s.name))
    if (chosen.length < wanted.size) {
      const foundNames = new Set(chosen.map((s) => s.name))
      const unknown = [...wanted].filter((n) => !foundNames.has(n))
      console.error(`[clody] unknown skills in CLODY_SKILLS: ${unknown.join(", ")}`)
    }
  } else {
    const matches = await skillState.router.route(queryText, skillState.skills, {
      limit: SKILL_LIMIT,
      threshold: cfg.skillThreshold ?? 0.55,
    })
    chosen = matches.map((m) => m.skill)
  }
  const cacheKey = skillBodyCacheKey(chosen.map((s) => s.name))
  // Cache hit => this set was already loaded (and logged) this process; skip the
  // disk re-read. loggedSkills stays in sync because both reset together in tests.
  if (skillBodyCache && skillBodyCache.key === cacheKey) return skillBodyCache.loaded
  const loaded: { name: string; body: string }[] = []
  for (const skill of chosen) {
    try {
      const body = await Bun.file(skill.bodyPath).text()
      loaded.push({ name: skill.name, body: body.replace(/^---\n[\s\S]*?\n---\n?/, "") })
    } catch {
      /* unreadable skill body — skip */
    }
  }
  const names = loaded.map((l) => l.name).join(", ")
  if (loaded.length > 0 && loggedSkills !== names) {
    loggedSkills = names
    console.error(`[clody] skills active: ${names} (override with CLODY_SKILLS=<names|none>)`)
  }
  skillBodyCache = { key: cacheKey, loaded }
  return loaded
}

async function defaultConfig(): Promise<BridgeConfig> {
  const path = join(homedir(), ".clody", "config.json")
  let raw: Record<string, unknown> = {}
  try {
    raw = (await Bun.file(path).json()) as Record<string, unknown>
  } catch {
    /* defaults below */
  }
  return {
    ollamaUrl: process.env["CLODY_OLLAMA_URL"] ?? (raw["ollamaUrl"] as string) ?? "http://localhost:11434",
    embeddingModel: (raw["embeddingModel"] as string) ?? "nomic-embed-text",
    maxContextTokens: (raw["maxContextTokens"] as number) ?? 32_000,
    stateDir: join(homedir(), ".clody", "ctx"),
    skillDirs: (raw["skillDirs"] as string[]) ?? DEFAULT_SKILL_DIRS,
    skillThreshold: (raw["skillThreshold"] as number) ?? 0.55,
  }
}

function project(cfg: BridgeConfig, directory: string) {
  let entry = projects.get(directory)
  if (entry) return entry
  mkdirSync(cfg.stateDir, { recursive: true })
  const dbName = createHash("sha256").update(directory).digest("hex").slice(0, 12) + ".db"
  const storage = new SqliteStorage(join(cfg.stateDir, dbName))
  const embedder = new OllamaEmbedder(cfg.ollamaUrl, cfg.embeddingModel)
  const indexer = new Indexer(storage, embedder)
  const retrieval = new RetrievalEngine(storage, embedder)
  const memory = new MemoryEngine(storage, embedder)
  const builder = new ContextBuilder(retrieval, memory, cfg.maxContextTokens)
  // Kick indexing once per process per directory; consumers await it but
  // failures must not poison the entry (retrieval degrades to keyword-only).
  const indexed = indexer
    .index({ workingDirectory: directory })
    .catch(() => undefined)
    .then((r) => {
      // clody-v2: prune/promote memories once per process — DBs must not grow forever
      void memory.consolidate().catch(() => {})
      return r
    })
  entry = { builder, indexed }
  projects.set(directory, entry)
  return entry
}

export async function buildClodyContext(input: BuildInput): Promise<string | undefined> {
  try {
    config ??= await defaultConfig()
    const cfg = config
    const { builder, indexed } = project(cfg, input.directory)
    await indexed
    const skills = await activeSkills(cfg, input.queryText)
    let skillSection = ""
    if (skills.length > 0) {
      const cap = Math.floor((cfg.maxContextTokens / 2) * SKILL_BUDGET_RATIO) * 4 // tokens→chars
      let text = skills.map((s) => `### Skill: ${s.name}\n${s.body.trim()}`).join("\n\n")
      if (text.length > cap) text = text.slice(0, cap) + "\n[skill content truncated to budget]"
      skillSection = `## Active Skills\n${text}\n\n`
    }
    // Build the message array from history, if provided.
    // captureFromMessages only captures errors from the LAST message.
    // When the last history entry is a toolError and queryText is also present,
    // we merge the tool_result block into the final user message's content array
    // alongside a text block for queryText, so the capture path sees the error.
    const hist = input.history ?? []
    let messages: { role: "user" | "assistant"; content: string | Array<{ type: string; [k: string]: unknown }> }[]
    const lastHistEntry = hist[hist.length - 1]
    if (lastHistEntry?.toolError !== undefined && input.queryText.trim().length > 0) {
      // Merge last toolError into the final message content array alongside queryText
      const priorHistory = hist.slice(0, -1).map((h, i) =>
        h.toolError !== undefined
          ? {
              role: h.role as "user" | "assistant",
              content: [
                { type: "tool_result" as const, tool_use_id: `clody-h${i}`, content: h.toolError, is_error: true },
              ],
            }
          : { role: h.role as "user" | "assistant", content: h.text ?? "" },
      )
      const finalIdx = hist.length - 1
      const finalContent: Array<{ type: string; [k: string]: unknown }> = [
        { type: "tool_result", tool_use_id: `clody-h${finalIdx}`, content: lastHistEntry.toolError, is_error: true },
        { type: "text", text: input.queryText },
      ]
      messages = [...priorHistory, { role: "user", content: finalContent }]
    } else {
      messages = [
        ...hist.map((h, i) =>
          h.toolError !== undefined
            ? {
                role: h.role as "user" | "assistant",
                content: [
                  { type: "tool_result" as const, tool_use_id: `clody-h${i}`, content: h.toolError, is_error: true },
                ],
              }
            : { role: h.role as "user" | "assistant", content: h.text ?? "" },
        ),
        { role: "user" as const, content: input.queryText },
      ]
    }
    const built = await builder.build(
      messages as Parameters<typeof builder.build>[0],
      { id: input.sessionID, workingDirectory: input.directory },
      input.baseTokens + Math.ceil(skillSection.length / 4),
    )
    const combined = skillSection + built.systemPromptPrefix
    return combined.length > 0 ? combined : undefined
  } catch (err) {
    if (!warnedOnce) {
      warnedOnce = true
      console.error(`[clody-context] disabled after error: ${err instanceof Error ? err.message : String(err)}`)
    }
    return undefined
  }
}

/** Test hook: replace config and drop all cached project engines. */
export function __resetBridgeForTests(next?: BridgeConfig): void {
  config = next
  projects.clear()
  warnedOnce = false
  skillState = undefined
  loggedSkills = undefined
  skillBodyCache = undefined
}
