import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { scanSkills } from "../src/skills/discovery"
import { SkillRouter } from "../src/skills/router"
import { DEFAULT_SKILL_DIRS } from "../src/skills"

function skillsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "clody-skills-"))
  mkdirSync(join(dir, "tdd"))
  writeFileSync(
    join(dir, "tdd", "SKILL.md"),
    `---\nname: tdd\ndescription: Test-driven development workflow for writing failing tests first\n---\nAlways write the failing test before the implementation.\n`,
  )
  mkdirSync(join(dir, "review"))
  writeFileSync(
    join(dir, "review", "SKILL.md"),
    `---\nname: review\ndescription: Code review checklist for merge requests\n---\nCheck naming, tests, and error handling.\n`,
  )
  mkdirSync(join(dir, "broken"))
  writeFileSync(join(dir, "broken", "SKILL.md"), `just a body, no frontmatter\n`)
  return dir
}

test("DEFAULT_SKILL_DIRS contains the three standard locations", () => {
  expect(DEFAULT_SKILL_DIRS).toHaveLength(3)
  expect(DEFAULT_SKILL_DIRS[0]).toContain(".config/clody/skills")
})

describe("scanSkills", () => {
  test("finds SKILL.md files with name+description, skips ones without", async () => {
    const skills = await scanSkills([skillsDir(), "/nonexistent/dir"])
    const names = skills.map((s) => s.name).toSorted()
    expect(names).toEqual(["review", "tdd"])
    const tdd = skills.find((s) => s.name === "tdd")!
    expect(tdd.description).toContain("failing tests")
    expect(tdd.bodyPath.endsWith("SKILL.md")).toBe(true)
  })

  test("parses folded block scalar description (> indicator)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clody-folded-"))
    mkdirSync(join(dir, "myskill"))
    writeFileSync(
      join(dir, "myskill", "SKILL.md"),
      `---\nname: myskill\ndescription: >\n  This is the first line\n  and the second line\n---\nSkill body here.\n`,
    )
    const skills = await scanSkills([dir])
    expect(skills).toHaveLength(1)
    expect(skills[0]!.description).toBe("This is the first line and the second line")
    expect(skills[0]!.description).not.toContain(">")
  })

  test("parses quoted single-line description", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clody-quoted-"))
    mkdirSync(join(dir, "qskill"))
    writeFileSync(
      join(dir, "qskill", "SKILL.md"),
      `---\nname: qskill\ndescription: "A quoted description with spaces"\n---\nBody.\n`,
    )
    const skills = await scanSkills([dir])
    expect(skills).toHaveLength(1)
    expect(skills[0]!.description).toBe("A quoted description with spaces")
  })

  test("follows symlinked skill directories", async () => {
    // Real dir with a skill
    const realDir = mkdtempSync(join(tmpdir(), "clody-real-"))
    mkdirSync(join(realDir, "symskill"))
    writeFileSync(
      join(realDir, "symskill", "SKILL.md"),
      `---\nname: symskill\ndescription: A skill found via symlink\n---\nSymlinked body.\n`,
    )
    // Scan dir with a symlink pointing at realDir/symskill
    const scanDir = mkdtempSync(join(tmpdir(), "clody-scan-"))
    symlinkSync(join(realDir, "symskill"), join(scanDir, "symskill"))
    const skills = await scanSkills([scanDir])
    const names = skills.map((s) => s.name)
    expect(names).toContain("symskill")
  })
})

describe("SkillRouter", () => {
  const fakeEmbedder = {
    embed: async (inputs: string[]) => ({
      embeddings: inputs.map((t) => {
        const s = t.toLowerCase()
        if (s.includes("test") || s.includes("tdd") || s.includes("failing")) return [1, 0]
        if (s.includes("review")) return [0, 1]
        return [0.5, 0.5]
      }),
    }),
  }

  test("routes a testing task to the tdd skill above threshold", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clody-cache-"))
    const router = new SkillRouter(fakeEmbedder, join(dir, "cache.json"))
    const skills = await scanSkills([skillsDir()])
    const matches = await router.route("write tests for the parser", skills, { limit: 3, threshold: 0.9 })
    expect(matches.length).toBeGreaterThan(0)
    expect(matches[0]!.skill.name).toBe("tdd")
    expect(matches[0]!.score).toBeGreaterThan(0.9)
  })

  test("returns empty when nothing clears the threshold", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clody-cache2-"))
    const router = new SkillRouter(fakeEmbedder, join(dir, "cache.json"))
    const skills = await scanSkills([skillsDir()])
    const matches = await router.route("deploy the infrastructure", skills, { limit: 3, threshold: 0.95 })
    expect(matches).toEqual([])
  })

  test("caches description embeddings on disk (second route embeds only the query)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clody-cache3-"))
    let calls = 0
    const counting = {
      embed: async (inputs: string[]) => {
        calls += inputs.length
        return fakeEmbedder.embed(inputs)
      },
    }
    const skills = await scanSkills([skillsDir()])
    const r1 = new SkillRouter(counting, join(dir, "cache.json"))
    await r1.route("write tests", skills, { limit: 3, threshold: 0.5 })
    const after1 = calls
    const r2 = new SkillRouter(counting, join(dir, "cache.json"))
    await r2.route("write more tests", skills, { limit: 3, threshold: 0.5 })
    expect(calls - after1).toBe(1) // only the new query
  })

  test("margin rule: drops candidates more than 0.08 below the top score", async () => {
    // Embedder that gives controllable scores: query=[1,0], tdd=[1,0]=1.0, review=[0,1]=0.0, deploy=[0.6,0.4]~0.83
    // We want scores 0.95 and 0.6 so both are above threshold but far apart
    const dir = mkdtempSync(join(tmpdir(), "clody-margin-"))
    const twoSkillsDir = mkdtempSync(join(tmpdir(), "clody-twoskills-"))
    mkdirSync(join(twoSkillsDir, "high"))
    writeFileSync(
      join(twoSkillsDir, "high", "SKILL.md"),
      `---\nname: high\ndescription: high scoring skill\n---\nHigh body.\n`,
    )
    mkdirSync(join(twoSkillsDir, "low"))
    writeFileSync(
      join(twoSkillsDir, "low", "SKILL.md"),
      `---\nname: low\ndescription: low scoring skill\n---\nLow body.\n`,
    )
    // query produces [1,0]; "high" -> [1,0] => score~1.0; "low" -> [0,1] => score~0.0
    // But we want threshold=0.5 to let both through before margin. Use a custom embedder:
    const controlled = {
      embed: async (inputs: string[]) => ({
        embeddings: inputs.map((t) => {
          if (t === "margin test query") return [1, 0]
          if (t.includes("high")) return [0.95, Math.sqrt(1 - 0.95 ** 2)] // score ~0.95 with [1,0]
          return [0.6, Math.sqrt(1 - 0.6 ** 2)] // score ~0.6 with [1,0]
        }),
      }),
    }
    const skills = await scanSkills([twoSkillsDir])
    const router = new SkillRouter(controlled, join(dir, "cache.json"))
    const matches = await router.route("margin test query", skills, { limit: 10, threshold: 0.5 })
    // gap is 0.95 - 0.6 = 0.35 > 0.08, so only "high" should survive
    expect(matches).toHaveLength(1)
    expect(matches[0]!.skill.name).toBe("high")
  })

  test("margin rule: keeps both when gap is within 0.08", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clody-margin2-"))
    const twoSkillsDir = mkdtempSync(join(tmpdir(), "clody-twoskills2-"))
    mkdirSync(join(twoSkillsDir, "alpha"))
    writeFileSync(
      join(twoSkillsDir, "alpha", "SKILL.md"),
      `---\nname: alpha\ndescription: alpha skill close scores\n---\nAlpha.\n`,
    )
    mkdirSync(join(twoSkillsDir, "beta"))
    writeFileSync(
      join(twoSkillsDir, "beta", "SKILL.md"),
      `---\nname: beta\ndescription: beta skill close scores\n---\nBeta.\n`,
    )
    const controlled = {
      embed: async (inputs: string[]) => ({
        embeddings: inputs.map((t) => {
          if (t === "close margin query") return [1, 0]
          if (t.includes("alpha")) return [0.95, Math.sqrt(1 - 0.95 ** 2)] // ~0.95
          return [0.90, Math.sqrt(1 - 0.90 ** 2)] // ~0.90; gap 0.05 < 0.08
        }),
      }),
    }
    const skills = await scanSkills([twoSkillsDir])
    const router = new SkillRouter(controlled, join(dir, "cache.json"))
    const matches = await router.route("close margin query", skills, { limit: 10, threshold: 0.5 })
    expect(matches).toHaveLength(2)
  })

  test("dimension guard: stale wrong-dimension cached vectors are skipped, no throw", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clody-dimguard-"))
    const skillsD = mkdtempSync(join(tmpdir(), "clody-dimskills-"))
    mkdirSync(join(skillsD, "dimskill"))
    writeFileSync(
      join(skillsD, "dimskill", "SKILL.md"),
      `---\nname: dimskill\ndescription: dimension guard test skill\n---\nBody.\n`,
    )
    const skills = await scanSkills([skillsD])
    // Pre-seed cache with a wrong-dimension vector under the salted key
    const salt = "testsalt"
    const description = skills[0]!.description
    const wrongKey = createHash("sha256").update(salt + " " + description).digest("hex")
    const staleCache: Record<string, number[]> = { [wrongKey]: [1, 0, 0] } // 3-dim, but query will be 2-dim
    await Bun.write(join(dir, "cache.json"), JSON.stringify(staleCache))
    // Embedder always produces 2-dim vectors
    const twoD = { embed: async (inputs: string[]) => ({ embeddings: inputs.map(() => [1, 0]) }) }
    const router = new SkillRouter(twoD, join(dir, "cache.json"), salt)
    // Should not throw; stale 3-dim vector is skipped, skill re-embeds as missing
    const matches = await router.route("test query", skills, { limit: 3, threshold: 0.5 })
    expect(matches).toHaveLength(1) // re-embedded with correct dim, score=1.0
    expect(matches[0]!.skill.name).toBe("dimskill")
  })
})
