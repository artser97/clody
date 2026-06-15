#!/usr/bin/env bun
// Fake clody bin for driver tests. argv: ["run", "<instruction>"].
// Behaviors keyed by instruction keywords; writes proof files into cwd.
const instruction = process.argv[3] ?? process.argv[2] ?? ""
if (instruction.includes("SLEEP")) {
  await new Promise((r) => setTimeout(r, 60_000))
}
if (instruction.includes("TOUCH")) {
  await Bun.write("touched.txt", "ok")
}
await Bun.write(
  "env-seen.json",
  JSON.stringify({
    judge: process.env["CLODY_JUDGE"] ?? null,
    skills: process.env["CLODY_SKILLS"] ?? null,
    context: process.env["CLODY_CONTEXT"] ?? null,
    pwd_env: process.env["PWD"] ?? null,
    cwd: process.cwd(),
  }),
)
console.log("fake bin done")
