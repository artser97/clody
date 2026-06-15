// packages/clody-core/test/hardware.test.ts
import { describe, expect, test } from "bun:test"
import { classifyHardware, deriveRamCeiling, type RawHardware } from "../src/hardware"

const base: RawHardware = {
  totalmemBytes: 32 * 1024 ** 3,
  cpuCount: 10,
  platform: "darwin",
  arch: "arm64",
  hasNvidia: false,
}

describe("classifyHardware", () => {
  test("Apple Silicon -> metal, unified memory", () => {
    const hw = classifyHardware(base)
    expect(hw.ramGB).toBe(32)
    expect(hw.cores).toBe(10)
    expect(hw.accelerator).toBe("metal")
    expect(hw.unifiedMemory).toBe(true)
  })

  test("Linux + nvidia -> cuda", () => {
    const hw = classifyHardware({ ...base, platform: "linux", arch: "x64", hasNvidia: true })
    expect(hw.accelerator).toBe("cuda")
    expect(hw.unifiedMemory).toBe(false)
  })

  test("Linux no gpu -> cpu", () => {
    const hw = classifyHardware({ ...base, platform: "linux", arch: "x64", hasNvidia: false })
    expect(hw.accelerator).toBe("cpu")
  })

  test("Intel mac -> cpu (no metal claim without arm64)", () => {
    const hw = classifyHardware({ ...base, arch: "x64" })
    expect(hw.accelerator).toBe("cpu")
  })
})

describe("deriveRamCeiling", () => {
  test("32GB -> 24 (reserve clamped to 8)", () => {
    expect(deriveRamCeiling(32)).toBe(24)
  })
  test("16GB -> 12 (25% reserve)", () => {
    expect(deriveRamCeiling(16)).toBe(12)
  })
  test("8GB -> 4 (reserve floored at 4)", () => {
    expect(deriveRamCeiling(8)).toBe(4)
  })
  test("never below 4", () => {
    expect(deriveRamCeiling(4)).toBe(4)
  })
})
