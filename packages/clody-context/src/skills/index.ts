import { homedir } from "node:os"
import { join } from "node:path"

/** Default scan locations, shared by the CLI confirm flow and the bridge. */
export const DEFAULT_SKILL_DIRS = [
  join(homedir(), ".config", "clody", "skills"),
  join(homedir(), ".config", "opencode", "skills"),
  join(homedir(), ".claude", "skills"),
]

export { scanSkills, type SkillInfo } from "./discovery"
export { SkillRouter, type SkillMatch, type RouteOptions } from "./router"
