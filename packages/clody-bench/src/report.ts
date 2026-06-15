import type { RunSummary, TaskResult } from "./types"

function cell(r: TaskResult | undefined): string {
  if (!r) return "—"
  const secs = `${Math.round(r.wallMs / 1000)}s`
  if (r.timedOut) return `⏱ ${secs}`
  return r.passed ? `✅ ${secs}` : `❌ ${secs}`
}

export function renderMarkdown(s: RunSummary): string {
  const arms = [...new Set(s.results.map((r) => r.arm))]
  const tasks = [...new Set(s.results.map((r) => r.task))]
  const find = (t: string, a: string) => s.results.find((r) => r.task === t && r.arm === a)
  const lines = [
    `# clody bench — ${s.label}`,
    ``,
    `- started: ${s.startedAt}`,
    `- model: ${s.model}`,
    ``,
    `| arm | passed |`,
    `|---|---|`,
    ...arms.map((a) => {
      const rs = s.results.filter((r) => r.arm === a)
      return `| ${a} | ${rs.filter((r) => r.passed).length}/${rs.length} |`
    }),
    ``,
    `| task | ${arms.join(" | ")} |`,
    `|---|${arms.map(() => "---").join("|")}|`,
    ...tasks.map((t) => `| ${t} | ${arms.map((a) => cell(find(t, a))).join(" | ")} |`),
    ``,
  ]
  return lines.join("\n")
}
