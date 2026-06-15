/**
 * Minimal static model profiles — context window and approximate RAM cost so
 * the CLI can pick an OLLAMA_CONTEXT_LENGTH that fits the machine. Phase 3
 * extends profiles with reasoning styles and probed capabilities.
 * RAM numbers are q4-quantized weights as served by Ollama defaults.
 */

/** How a model surfaces its chain-of-thought in OpenAI-style streaming. */
export type ReasoningStyle =
  | 'reasoning-field' // delta.reasoning (qwen3 via Ollama)
  | 'reasoning-content-field' // delta.reasoning_content (DeepSeek-style)
  | 'think-tags' // inline <think>…</think> in delta.content
  | 'none'

export interface ModelProfile {
  pattern: RegExp
  contextWindow: number
  weightsGB: number
  /** Approximate KV-cache GB per 8192 tokens of context. */
  kvGBPer8k: number
  reasoning: ReasoningStyle
}

export const DEFAULT_PROFILE: ModelProfile = {
  pattern: /./,
  contextWindow: 32768,
  weightsGB: 8,
  kvGBPer8k: 1.0,
  reasoning: 'none',
}

const PROFILES: ModelProfile[] = [
  { pattern: /^qwen3:8b/, contextWindow: 32768, weightsGB: 5.2, kvGBPer8k: 0.7, reasoning: 'reasoning-field' },
  { pattern: /^qwen3:4b/, contextWindow: 32768, weightsGB: 2.6, kvGBPer8k: 0.45, reasoning: 'reasoning-field' },
  { pattern: /^qwen2\.5:14b/, contextWindow: 32768, weightsGB: 9, kvGBPer8k: 1.0, reasoning: 'none' },
  { pattern: /^qwen2\.5:/, contextWindow: 32768, weightsGB: 4.7, kvGBPer8k: 0.7, reasoning: 'none' },
  { pattern: /^gemma4:12b/, contextWindow: 32768, weightsGB: 7.7, kvGBPer8k: 1.0, reasoning: 'none' },
  { pattern: /^deepseek-r1/, contextWindow: 32768, weightsGB: 5.2, kvGBPer8k: 0.7, reasoning: 'reasoning-content-field' },
  { pattern: /^codestral/, contextWindow: 32768, weightsGB: 13, kvGBPer8k: 1.0, reasoning: 'none' },
  { pattern: /^qwen3-coder/, contextWindow: 32768, weightsGB: 19, kvGBPer8k: 1.0, reasoning: 'none' },
  { pattern: /^devstral/, contextWindow: 32768, weightsGB: 14, kvGBPer8k: 1.0, reasoning: 'none' },
  { pattern: /^qwen3:14b/, contextWindow: 32768, weightsGB: 9.3, kvGBPer8k: 1.0, reasoning: 'reasoning-field' },
  { pattern: /^qwen3:32b/, contextWindow: 32768, weightsGB: 20, kvGBPer8k: 1.0, reasoning: 'reasoning-field' },
  { pattern: /^qwen3\.5:27b/, contextWindow: 32768, weightsGB: 17, kvGBPer8k: 1.0, reasoning: 'reasoning-field' },
  { pattern: /^qwen3\.5:9b/, contextWindow: 32768, weightsGB: 6.6, kvGBPer8k: 0.7, reasoning: 'reasoning-field' },
]

export function getModelProfile(model: string): ModelProfile {
  return PROFILES.find((p) => p.pattern.test(model)) ?? DEFAULT_PROFILE
}

const NUM_CTX_STEPS = [4096, 8192, 16384, 32768]

/**
 * Largest standard num_ctx that fits the RAM ceiling and the model's window;
 * prefers the smallest step that still satisfies desiredTokens.
 */
export function chooseNumCtx(profile: ModelProfile, ramCeilingGB: number, desiredTokens: number): number {
  const fits = (ctx: number): boolean =>
    profile.weightsGB + (ctx / 8192) * profile.kvGBPer8k <= ramCeilingGB
  const allowed = NUM_CTX_STEPS.filter((s) => s <= profile.contextWindow && fits(s))
  if (allowed.length === 0) return NUM_CTX_STEPS[0]!
  const enough = allowed.find((s) => s >= desiredTokens)
  return enough ?? allowed[allowed.length - 1]!
}
