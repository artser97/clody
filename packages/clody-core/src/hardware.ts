// packages/clody-core/src/hardware.ts
/**
 * Hardware detection for model recommendation. classifyHardware is pure over
 * RawHardware so it is fully unit-testable; detectHardware gathers the raw
 * values from the host.
 */
import { totalmem, cpus } from "node:os"
import { spawnSync } from "node:child_process"

export type Accelerator = "metal" | "cuda" | "cpu"

export interface RawHardware {
  totalmemBytes: number
  cpuCount: number
  platform: NodeJS.Platform
  arch: string
  hasNvidia: boolean
}

export interface Hardware {
  ramGB: number
  cores: number
  accelerator: Accelerator
  unifiedMemory: boolean
}

export function classifyHardware(raw: RawHardware): Hardware {
  const isAppleSilicon = raw.platform === "darwin" && raw.arch === "arm64"
  const accelerator: Accelerator = isAppleSilicon ? "metal" : raw.hasNvidia ? "cuda" : "cpu"
  return {
    ramGB: Math.round(raw.totalmemBytes / 1024 ** 3),
    cores: raw.cpuCount,
    accelerator,
    unifiedMemory: isAppleSilicon,
  }
}

/** Reserve = clamp(ram*0.25, 4, 8); ceiling = max(ram - reserve, 4). */
export function deriveRamCeiling(ramGB: number): number {
  const reserve = Math.min(Math.max(ramGB * 0.25, 4), 8)
  return Math.max(Math.round(ramGB - reserve), 4)
}

function nvidiaPresent(): boolean {
  try {
    const r = spawnSync("nvidia-smi", ["-L"], { timeout: 2000, stdio: "ignore" })
    return r.status === 0
  } catch {
    return false
  }
}

export function detectHardware(): Hardware {
  return classifyHardware({
    totalmemBytes: totalmem(),
    cpuCount: cpus().length,
    platform: process.platform,
    arch: process.arch,
    hasNvidia: process.platform === "linux" ? nvidiaPresent() : false,
  })
}
