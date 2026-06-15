/**
 * Probe-driven opencode configuration: the slim agent (3,031 prompt tokens
 * measured in the 2026-06-12 spike vs Claude Code's ~20k) and the Ollama
 * provider block. Pure functions — file writes happen in clody-cli.
 */
import type { ProbeResult } from "./probe"

export interface AgentInput {
  model: string
  probe: ProbeResult
}

export function renderAgentMarkdown(input: AgentInput): string {
  const rules = [
    "- Make every change by CALLING the edit, write, or bash tools yourself. NEVER print code blocks, file contents, shell commands, or tool calls as text for the user to run or apply. Describing a change is not doing it — a turn that explains edits without calling a tool is a failure.",
    "- Do not ask the user to run commands or confirm steps. Act: read, edit, and verify autonomously until the task is done.",
    "- NEVER end your turn to announce the next step ('Let's do X', 'Next I will…', 'Now we need to…'). Do that step immediately in the SAME turn by calling the tool. Chain as many tool calls as the task needs. Stop only when the whole task is complete and verified, or you are genuinely blocked and must ask a question.",
    "- Use the read tool before editing any file.",
    "- Use grep/glob to find code; never guess file contents.",
    "- Make the smallest change that satisfies the request.",
    "- After editing, verify with bash (run the relevant build or test command) when one is obvious.",
    "- Reply concisely: state what you changed and why in 1-3 sentences.",
  ]
  if (input.probe.reasoningStyle !== "none") {
    rules.push("- Do not narrate step-by-step reasoning in your reply; think internally, answer short.")
  }
  if (!input.probe.parallelToolCalls) {
    rules.push("- Make one tool call at a time and wait for its result.")
  }

  return `---
description: clody slim agent tuned for local models (generated — do not edit)
mode: primary
model: ollama/${input.model}
temperature: 0.2
permission:
  read: allow
  edit: allow
  write: allow
  bash: allow
  glob: allow
  grep: allow
  list: allow
  skill: deny
  webfetch: deny
  task: deny
  todowrite: deny
  todoread: deny
  patch: deny
---
You are a coding assistant running on a local model. Work inside the current project directory.

Rules:
${rules.join("\n")}
`
}

export interface ProviderInput {
  model: string
  ollamaUrl: string
  contextTokens: number
  outputTokens: number
}

export interface ProviderConfig {
  model: string
  provider: {
    ollama: {
      npm: string
      name: string
      options: { baseURL: string }
      models: Record<string, { name: string; limit: { context: number; output: number } }>
    }
  }
}

export function renderProviderConfig(input: ProviderInput): ProviderConfig {
  return {
    model: `ollama/${input.model}`,
    provider: {
      ollama: {
        npm: "@ai-sdk/openai-compatible",
        name: "Ollama (local)",
        options: { baseURL: `${input.ollamaUrl}/v1` },
        models: {
          [input.model]: {
            name: input.model,
            limit: { context: input.contextTokens, output: input.outputTokens },
          },
        },
      },
    },
  }
}
