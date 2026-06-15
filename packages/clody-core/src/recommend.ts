// packages/clody-core/src/recommend.ts
/**
 * Pure recommendation: rank the curated registry against detected hardware.
 * Reuses chooseNumCtx to find the largest context a model can run in the
 * machine's RAM ceiling, then assigns a fit verdict and picks a default.
 */
import { CURATED_MODELS, type CuratedModel } from "./models"
import { chooseNumCtx, type ModelProfile } from "./profiles"
import { deriveRamCeiling, type Hardware } from "./hardware"

export type FitVerdict = "comfy" | "ok" | "too-big"

export interface RankedCandidate {
  model: CuratedModel
  verdict: FitVerdict
  /** Largest standard num_ctx that fits the ceiling (0 if it does not fit). */
  maxCtx: number
  isDefault: boolean
}

function asProfile(m: CuratedModel): ModelProfile {
  return {
    pattern: /./,
    contextWindow: m.contextWindow,
    weightsGB: m.weightsGB,
    kvGBPer8k: m.kvGBPer8k,
    reasoning: m.reasoning,
  }
}

function verdictFor(m: CuratedModel, ramGB: number, ceilingGB: number): { verdict: FitVerdict; maxCtx: number } {
  if (ramGB < m.minRAMGB || m.weightsGB >= ceilingGB) return { verdict: "too-big", maxCtx: 0 }
  // chooseNumCtx returns the smallest step >= desired that fits, or the largest
  // that fits; ask for the model's full window so we learn the true max.
  const maxCtx = chooseNumCtx(asProfile(m), ceilingGB, m.contextWindow)
  const fits = m.weightsGB + (maxCtx / 8192) * m.kvGBPer8k <= ceilingGB
  // Re-validate fits: chooseNumCtx can return its 4096 fallback even when that
  // step does not fit the ceiling, so we must check the actual budget here.
  if (!fits) return { verdict: "too-big", maxCtx: 0 }
  if (maxCtx >= 16384) return { verdict: "comfy", maxCtx }
  return { verdict: "ok", maxCtx }
}

const RANK = { comfy: 0, ok: 1, "too-big": 2 } as const

export function recommendModels(hardware: Hardware, registry: CuratedModel[] = CURATED_MODELS): RankedCandidate[] {
  const ceiling = deriveRamCeiling(hardware.ramGB)
  const scored: RankedCandidate[] = registry.map((model) => {
    const { verdict, maxCtx } = verdictFor(model, hardware.ramGB, ceiling)
    return { model, verdict, maxCtx, isDefault: false }
  })

  scored.sort((a, b) => {
    if (RANK[a.verdict] !== RANK[b.verdict]) return RANK[a.verdict] - RANK[b.verdict]
    if (b.model.codingTier !== a.model.codingTier) return b.model.codingTier - a.model.codingTier
    if (a.model.weightsGB !== b.model.weightsGB) return a.model.weightsGB - b.model.weightsGB
    return a.model.tag.localeCompare(b.model.tag)
  })

  // Default = highest coding tier among comfy, else among ok.
  const pickFrom = (v: FitVerdict): RankedCandidate | undefined =>
    scored.filter((s) => s.verdict === v).sort((a, b) => b.model.codingTier - a.model.codingTier)[0]
  const def = pickFrom("comfy") ?? pickFrom("ok")
  if (def) def.isDefault = true

  return scored
}
