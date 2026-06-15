# Phase A baseline — 2026-06-12

- opencode fork: v1.17.4, branch clody-main
- model: gemma4:12b (probe: streaming ✓, tools ✓, parallel ✓, reasoning reasoning-field)
- prompt tokens, clody-local agent: 3,047  (neutral cwd; spike reference: 3,031; Claude Code: ~20k)
- palindrome smoke: PASS, wall ~711s warm (attempt 3; attempts 1-2 failed: model did not use tools with standard prompt)
- trivial prompt wall time: ~94s cold, ~53s warm
- invocation form that worked for sandboxed headless runs: `bun /Users/artsiomsiarebranikau/clody-v2/packages/clody-cli/src/bin.ts run "<prompt>"`

## Token measurement note

The earlier figure of 5,095 was inflated: the measurement ran with cwd inside the fork repo, causing opencode to inject the repo's own `AGENTS.md` (upstream verbose style guide) into the system prompt, adding ~2,000+ tokens. A real user's project has no such file. Re-measured from an empty neutral directory (`/tmp/clody-baseline`) gives 3,047 — within ≤3,500 and matching the spike baseline of 3,031. Projects with large AGENTS.md / CLAUDE.md files will add to this budget; managing that overhead is a Phase B context-engine concern.

## Phase B — context engine (2026-06-12)

- packages/clody-context: storage (bun:sqlite) + retrieval + memory + indexer + builder + bridge; 30 bun tests green
- core diff: packages/opencode/src/session/prompt.ts marked block + package.json dep (only)
- context smoke: prompt_tokens 3177 with injected context vs 3,047 bare (budget respected: yes)
- injected section referenced src/auth.ts for an auth query: yes
- kill switch CLODY_CONTEXT=0 verified: yes (prompt_tokens 3056)
- fail-soft live check (direct ollama, embeddings best-effort): pass
- parser: native tree-sitter under Bun

## Phase C — skill router (2026-06-12)

- skills subsystem: discovery + embedding router + vector cache; bridge injection with CLODY_SKILLS contract; CLI confirm for `clody run`
- tests: clody-context 38, clody-cli 5, clody-core 24
- forced-skill smoke (CLODY_SKILLS=clody-style): Active Skills section in payload: yes; prompt_tokens 3101
- auto-route smoke (threshold 0.55, nomic-embed-text): routed yes (clody-style score 0.7374, address-review 0.5769, go-review 0.5769)
- non-TTY guard: no prompt, no hang: pass
- core diff: unchanged from Phase B (prompt.ts marked block edits only)
- post-review fixes: folded-YAML descriptions + symlinked skill dirs (discovery now sees 14 real skills, was 6); model-salted vector cache; 0.08 margin rule. Re-measured auto-route: clody-style:0.738 (address-review/go-review 0.577 dropped by margin rule)

## Phase D — stability (2026-06-13)

- memories survive schema recreates (export/reimport; embeddings rebuilt as derived data)
- history plumbing live: error tool_results → failure memories (smoke: ToolPart mapping covers tp.state.status==="error" tool failures AND status==="completed" bash tools with metadata.exit !== 0; failure memory confirmed: `[failure/episodic] bash exit 1: ls /definitely/not/a/real/path-zzz` written to correct project DB; fix: prompt.ts checks tp.tool==="bash" && metadata.exit non-zero on completed state)
- judge-verified stop: trivial ask no-bounce pass (~65s); task completion pass (~56s); CLODY_JUDGE=0 verified (~36s, faster without judge call)
- config knobs: outputTokens/skillThreshold/skillDirs read from ~/.clody/config.json
- tests: clody-context 48, clody-cli 5, clody-core 24
- core diff: 2 files; prompt.ts now has TWO marked blocks (context injection + judge)
- judge default: config knob judgeMode=on|off|tui (default tui — one-shot runs skip the judge; CLODY_JUDGE env overrides)
- synthetic parts excluded from clodyQuery and clodyHistory (judge-bounce system-reminders no longer pollute working-tier memories)
