import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const THEMES = join(import.meta.dir, "../../tui/src/theme/assets")

async function readTheme(name: string): Promise<any> {
  return await Bun.file(join(THEMES, name)).json()
}

describe("clody theme asset", () => {
  test("defines the same theme color keys as opencode.json", async () => {
    const clody = await readTheme("clody.json")
    const opencode = await readTheme("opencode.json")
    expect(Object.keys(clody.theme).sort()).toEqual(Object.keys(opencode.theme).sort())
  })

  test("every color has dark+light and resolves to hex or a def", async () => {
    const clody = await readTheme("clody.json")
    const defs = new Set(Object.keys(clody.defs ?? {}))
    const isHex = (v: string) => /^#[0-9a-fA-F]{3,8}$/.test(v)
    for (const [key, val] of Object.entries<any>(clody.theme)) {
      expect(val.dark, `${key}.dark`).toBeDefined()
      expect(val.light, `${key}.light`).toBeDefined()
      for (const v of [val.dark, val.light]) {
        expect(isHex(v) || defs.has(v), `${key} value ${v}`).toBe(true)
      }
    }
  })
})
