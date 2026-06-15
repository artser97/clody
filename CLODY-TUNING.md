# clody — local-model tuning: findings, fixes, and roadmap

Living context doc for making clody actually complete real coding tasks on a
laptop-local model. Pairs with [CLODY.md](CLODY.md) (layout) and
[BASELINE.md](BASELINE.md) (phase log). Last updated: 2026-06-15.

## Mission

clody is an OpenCode fork tuned for local models. The goal is **NOT to clone
[MiMo-Code](https://github.com/XiaomiMiMo/MiMo-Code)** (same OpenCode-fork family)
— it is to be a **better product for local models**. MiMo is the bar to beat.

**Core principle:** when a local model fails an agentic task, that is a **harness
gap to fix**, not a fixed model ceiling. "Use a bigger model" is a fallback, not
the first answer.

**Where clody beats MiMo** (optimizing for the local constraint: tiny context,
slow per-call, weak tool-use, messy decode, varies per machine):

1. **Tool-schema budget** — MiMo ships all tool schemas every turn (~12.8k chars
   measured). clody filters them per task (`CLODY_TOOLS`) and will slim the
   schemas themselves. Fit the agent in the window MiMo overflows.
2. **Frugality of model calls** — local inference is slow; every call hurts. MiMo
   adds judge calls and best-of-N (more calls). clody minimizes calls: cheap
   deterministic checks first, a judge only when ambiguous.
3. **Model-aware adaptation** — clody probes the model and derives the profile
   (tool count, prompt, decode caps, num_ctx). MiMo is one-size-fits-all.
4. **Decode discipline** — strip reasoning/control tokens, repair tool calls, cap
   output. MiMo assumes a clean model.
5. **Bench-driven tuning** — clody's 15-task bench measures pass-rate per model and
   tunes the harness empirically.

## Verified facts (from live testing on an M-series 32 GB Mac, Ollama)

Tool-calling over Ollama's OpenAI-compatible endpoint is **model-template
dependent** — having the `tools` capability is not enough:

| Model | Structured `tool_calls`? | Notes |
|---|---|---|
| `qwen2.5:14b` | ✅ streaming + non-streaming | **Current default.** Best agentic discipline that fits 32 GB. |
| `qwen2.5:7b` | ✅ | Cold first call can emit garbage → probe must warm/retry. Lighter option. |
| `qwen3:8b` | ✅ | Reasoning model (thinks before acting); extra latency/turn. |
| `gemma4:12b` | ✅ | But leaks `<|channel>` reasoning/control tokens + malformed tool names on long tasks → derails. |
| `qwen3:14b` / `qwen3:32b` | ✅ (`tools`+`thinking` per Ollama) | Added to the registry. 32b is the "max quality · slow · 32 GB-tight" option. |
| `qwen3-coder:30b` | ✅ (`tools`) | **Coding model WITH native tools** — 30B MoE (3.3B active) → fast despite 19 GB. Added. |
| `devstral:24b` | ✅ (`tools`) | Mistral's agentic coder (14 GB). Added. |
| `qwen2.5-coder:7b` | ❌ returns tool calls as **plain text** (`tool_calls: null`) | Coder template gap — **excluded.** |
| `codestral:22b` | ❌ no `tools` capability (text-only template) | **Removed from the registry** (was a mis-curation — couldn't drive the agent). |
| `deepseek-coder-v2:16b` | ❌ no `tools` capability | Not added; a tool-call **converter** (Project 2) could enable it. |

The dividing line is the **chat template + tool post-training, not coding skill**: older
coder checkpoints (`qwen2.5-coder`, `codestral`, `deepseek-coder-v2`) are text-only; the
agent-tuned coders (`qwen3-coder`, `devstral`) and instruct/general lines have native tools.
Verify any tag with **`clody probe [tag…]`** (pulls + probes + prints a tools PASS/FAIL table).

Other findings:
- The opencode **TUI is solid-js**; launching it from an arbitrary cwd skipped
  `@opentui/solid`'s preload → `react/jsx-dev-runtime` crash. Fixed by injecting
  `--preload`.
- **Working directory matters**: the target repo was double-nested
  (`podimo-api-website/podimo-api-website/`); launching from the wrong level made
  the agent flail and write bogus files. Launch from the actual project root.
- **Tool schemas ≈ 12.8k chars/turn** — a major local-context tax.

## Failure modes observed → fix status

| # | Symptom | Root cause | Status |
|---|---|---|---|
| 1 | TUI felt like vanilla opencode | Bare `clody` launched opencode's heavy default "build" agent, not slim `clody-local` (agent only forced for `run`) | ✅ `6ac2551b8` |
| 2 | TUI crash `react/jsx-dev-runtime` | solid preload not loaded when launching from user cwd | ✅ `97e732fcf` |
| 3 | Wizard rejected a good model | Probe false-negative on a cold, just-pulled model | ✅ `bc26ce771` (retry) |
| 4 | Recommended a tool-broken model | Registry ranked `qwen2.5-coder:7b` #1 (no usable tools on Ollama) | ✅ `bc26ce771` / `1cd122a8c` |
| 5 | Model narrates edits instead of editing | 7B weakness; no harness rule | 🟡 mitigated `0e912cf86` (prompt rule); model-quality bound |
| 6 | Agent flails, writes bogus files | Wrong working directory (nested repo) | 🟡 user launches from root; harness "orient-first" is a lever (#0) |
| 7 | Junk `[clody] skills active: …` + random skills | TUI auto-routed/injected skills every turn (confirm only wired for `run`) | ✅ `ee279a533` (TUI defaults to zero skills) → superseded by the **session-start skill selector** (user picks; no silent auto-route) |
| 11 | **Skill selection dormant in the TUI** (defaulted to `none`) + active skills re-read from disk every step | The zero-default fix (#7) turned skills off entirely in the TUI; the bridge also re-read skill bodies per step | ✅ session-start `selectSkills` multiselect sets `CLODY_SKILLS` + `skills[]` config; bridge caches bodies per resolved set |
| 8 | All tool schemas sent every turn | No per-task tool selection existed (only a static permission allowlist) | ✅ `c3da35860` + `1e1bf67d6` |
| 9 | **Agent stops mid-task; must type "continue"** | Judge bounced **once** per session then gave up | ✅ `80ea2ddaa` (multi-bounce auto-continue) |
| 10 | **Model repeats the same tool call forever** (e.g. gemma4 looping one `Edit` 50+×) | No loop guard + `clody-local` has no step cap → `maxSteps=Infinity`; the auto-continue judge only guards `result==="stop"`, which a tool-call loop never reaches | ✅ loop-breaker (`detectToolLoop` in clody-context + `prompt.ts` hook): nudge at 3 identical calls, break at 6 |

## Shipped this session (on `clody-main`)

Onboarding wizard (merged): `adabdf66c` registry · `5045fe41a` hardware ·
`0ac4acc16` recommend · `886a4357b` installer · `8f62accd1` config/exports ·
`31d8852b1` banner · `aef3be237` wizard · `6cf9579d2` bin wiring · `69cad07db`
banner-at-start.

Local-model hardening: `97e732fcf` solid preload · `6ac2551b8` clody-local in TUI
· `bc26ce771` probe retry + registry · `0e912cf86` + `e5a0e3a82` agent rules
(no-narrate, no-premature-stop) · `1cd122a8c` qwen2.5:14b default · `ee279a533`
TUI zero-skills · `c3da35860` tool-selection mechanism · `1e1bf67d6` tool selector
· `80ea2ddaa` multi-bounce auto-continue.

UI branding (clody as a product, not opencode + clack defaults): a shared brand
kit `packages/clody-cli/src/style.ts` (teal→violet palette, one color/TTY gate,
painters, glyphs, `step/ok/warn/err` status helpers) now drives the banner,
`bin.ts` status lines (dropped the `[clody]` prefix), the skills/tools prompts, and
the wizard framing. A `clody` opencode TUI theme (`packages/tui/src/theme/assets/
clody.json`, registered in `theme/index.ts`) carries the identity into the chat
itself; `setup.ts` defaults `~/.config/opencode/tui.json` to it unless the user
already chose a theme. Spec/plan: `docs/superpowers/specs/2026-06-15-clody-ui-branding-design.md`,
`docs/superpowers/plans/2026-06-15-clody-ui-branding.md`.

## Operational reference

**Run from the actual project root** (the dir with `build.gradle`/`package.json`/`src`).

Commands: `clody` (TUI) · `clody run "<task>"` (one-shot) · `clody init` (wizard) ·
`clody model` (re-pick model) · `clody probe [tag…]` (pull + probe; tools PASS/FAIL
report — no args probes the configured model).

`~/.clody/config.json` keys: `model`, `ollamaUrl`, `embeddingModel`,
`maxContextTokens`, `ramCeilingGB`, `outputTokens`, `skillThreshold`,
`judgeMode` (`on`|`off`|`tui`), `tools` (string[]; default tool allowlist, `[]` =
all), `probes`.

Env overrides:
- `CLODY_MODEL`, `CLODY_OLLAMA_URL`, `CLODY_REPROBE=1` (force re-probe)
- `CLODY_JUDGE=0` — disable the judge **and** auto-continue
- `CLODY_MAX_CONTINUE` — max auto-continue bounces/session (default 12; also capped by step ≤ 30)
- `CLODY_SKILLS` — `none` or comma list (TUI defaults to `none`)
- `CLODY_TOOLS` — comma list of active tools (unset/empty = all)
- `CLODY_CONTEXT=0` — disable context-engine injection
- `CLODY_LOOPBREAK=0` — disable the repeated-tool-call loop-breaker
- `CLODY_MAX_REPEAT` — identical-tool-call run length that breaks the loop (default 6; warns at 3)

**Caveat:** auto-continue rides on `CLODY_JUDGE`. It is **on in the TUI** but
**off for one-shot `clody run`** (because `judgeMode: "tui"` skips the judge for
one-shots). For big `clody run` tasks: `CLODY_JUDGE=1 clody run "…"` or set
`"judgeMode": "on"`. (See roadmap #3 — decouple these.)

## Roadmap (prioritized harness levers)

- **#0 Working-dir orientation** — detect a non-project cwd / make the agent glob
  for real paths before creating files (failure #6).
- **#1 Auto-continue** — ✅ done (`80ea2ddaa`).
- **#2 Tool-schema slimming** — terser, local-tuned tool descriptions; cuts tokens
  every turn regardless of selection. Complements `CLODY_TOOLS`. **Biggest open
  tool-budget win.**
- **#3 Decouple auto-continue from the completion judge** — so it's always on for
  `clody run`, not gated by `judgeMode`.
- **#4 Step-wise execution** — re-enable a managed todo loop + per-task progress
  (MiMo's task tree); `clody-local` currently denies `todowrite`/`todoread`.
- **#5 Reasoning/control-token stripping** — middleware on opencode's
  `wrapLanguageModel` seam (`llm.ts`) to strip `<|channel>…<channel|>` so
  reasoning models (gemma4) stop derailing.
- **#5b Tool-call converter (Project 2)** — same `wrapLanguageModel` seam: prompt
  tool-less coder models (`deepseek-coder-v2`, `codestral`, `qwen2.5-coder`) to emit
  a parseable tool-call format and convert it to structured `tool_calls` (ReAct-style).
  Lets no-native-tools coders act as agents. Design against `clody probe` output.
- **#6 In-TUI skill/tool picker** — ✅ **session-start** part done: the TUI now
  opens a multiselect (`selectSkills`) so the user picks skills for the session,
  pre-ticked from the `skills[]` config; selection is stable + body-cached. Still
  open: a `/skills` / `/tools` slash command to re-pick **mid-session** (needs an
  in-TUI solid component), and an equivalent in-TUI tool picker.
- **#7 Context reconstruction** near the window limit — verify/extend.
- **#8 Bench-driven tuning (Phase E)** — run the 15-task bench per model, measure
  pass-rate, tune prompt/tools/continue-cap empirically. No real bench run exists yet.
- **Later:** `/dream` (session traces → memory) and `/distill` (workflows → skills).

## Honest bound

The harness now makes the agent **autonomous** (slim agent, structured tools,
tool selection, keeps going). Whether each step is **correct** still depends on
the model's per-step quality — a 14B will still occasionally write a wrong
migration or take a ticket's shorthand path literally. Autonomy and correctness
are different levers; the bench loop (#8) is how we measure and push correctness.
