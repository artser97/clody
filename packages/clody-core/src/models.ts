/**
 * Curated shortlist of local coding models clody ships a tuned profile for.
 * Only models in this list are recommended or offered — no arbitrary tags.
 * weightsGB / kvGBPer8k are q4-quantized estimates as served by Ollama
 * defaults; verify with `ollama show <tag>` before adjusting.
 */
import type { ReasoningStyle } from "./profiles"

export interface CuratedModel {
  tag: string
  displayName: string
  /** q4 weight footprint in GB. */
  weightsGB: number
  /** Approx KV-cache GB per 8192 tokens of context. */
  kvGBPer8k: number
  contextWindow: number
  reasoning: ReasoningStyle
  /** Higher = stronger at agentic coding. Drives the default pick. */
  codingTier: number
  /** Floor of system RAM (GB) below which we never offer this model. */
  minRAMGB: number
  /** One-line "best for" note shown in the picker. */
  blurb: string
}

// Curation criterion beyond coding skill: the model must emit STRUCTURED tool
// calls through Ollama's OpenAI-compatible endpoint. Models whose Ollama template
// has no `tools` capability are excluded — `qwen2.5-coder`, `codestral`, and
// `deepseek-coder-v2` return text only (tool_calls: null), so the agent never sees
// an action. The agent-tuned coders `qwen3-coder` and `devstral` DO have tools.
export const CURATED_MODELS: CuratedModel[] = [
  {
    tag: "qwen2.5:14b",
    displayName: "Qwen2.5 14B Instruct",
    weightsGB: 9,
    kvGBPer8k: 1.0,
    contextWindow: 32768,
    reasoning: "none",
    codingTier: 7,
    minRAMGB: 16,
    blurb: "coding · best agentic discipline (needs 16GB+)",
  },
  {
    tag: "qwen2.5:7b",
    displayName: "Qwen2.5 7B Instruct",
    weightsGB: 4.7,
    kvGBPer8k: 0.7,
    contextWindow: 32768,
    reasoning: "none",
    codingTier: 6,
    minRAMGB: 8,
    blurb: "coding · reliable tools · lighter",
  },
  {
    tag: "gemma4:12b",
    displayName: "Gemma 4 12B",
    weightsGB: 7.7,
    kvGBPer8k: 1.0,
    contextWindow: 32768,
    reasoning: "none",
    codingTier: 4,
    minRAMGB: 12,
    blurb: "all-round",
  },
  {
    tag: "qwen3:8b",
    displayName: "Qwen3 8B",
    weightsGB: 5.2,
    kvGBPer8k: 0.7,
    contextWindow: 32768,
    reasoning: "reasoning-field",
    codingTier: 3,
    minRAMGB: 8,
    blurb: "general",
  },
  {
    tag: "deepseek-r1:8b",
    displayName: "DeepSeek-R1 8B",
    weightsGB: 5.2,
    kvGBPer8k: 0.7,
    contextWindow: 32768,
    reasoning: "reasoning-content-field",
    codingTier: 3,
    minRAMGB: 8,
    blurb: "reasoning",
  },
  {
    tag: "qwen3-coder:30b",
    displayName: "Qwen3-Coder 30B (MoE)",
    weightsGB: 19,
    kvGBPer8k: 1.0,
    contextWindow: 32768,
    reasoning: "none",
    codingTier: 6,
    minRAMGB: 24,
    blurb: "agentic coding · MoE (fast) · native tools",
  },
  {
    tag: "devstral:24b",
    displayName: "Devstral 24B",
    weightsGB: 14,
    kvGBPer8k: 1.0,
    contextWindow: 32768,
    reasoning: "none",
    codingTier: 6,
    minRAMGB: 20,
    blurb: "agentic coding · native tools (Mistral)",
  },
  {
    tag: "qwen3:14b",
    displayName: "Qwen3 14B",
    weightsGB: 9.3,
    kvGBPer8k: 1.0,
    contextWindow: 32768,
    reasoning: "reasoning-field",
    codingTier: 6,
    minRAMGB: 16,
    blurb: "coding · reasoning · strong",
  },
  {
    tag: "qwen3:32b",
    displayName: "Qwen3 32B",
    weightsGB: 20,
    kvGBPer8k: 1.0,
    contextWindow: 32768,
    reasoning: "reasoning-field",
    codingTier: 6,
    minRAMGB: 28,
    blurb: "max quality · slow · 32GB-tight",
  },
  {
    tag: "qwen3.5:27b",
    displayName: "Qwen3.5 27B",
    weightsGB: 17,
    kvGBPer8k: 1.0,
    contextWindow: 32768,
    reasoning: "reasoning-field",
    codingTier: 6,
    minRAMGB: 22,
    blurb: "newest multimodal · native tools · bench candidate",
  },
  {
    tag: "qwen3.5:9b",
    displayName: "Qwen3.5 9B",
    weightsGB: 6.6,
    kvGBPer8k: 0.7,
    contextWindow: 32768,
    reasoning: "reasoning-field",
    codingTier: 5,
    minRAMGB: 8,
    blurb: "newest multimodal · native tools · lighter",
  },
]
