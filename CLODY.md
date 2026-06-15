# clody — opencode fork tuned for local models

This repo is a fork of https://github.com/anomalyco/opencode pinned at v1.17.4
(branch `clody-main`, remote `upstream`).

## Fork rules
- All clody code lives in `packages/clody-*`. Diffs to upstream files must be
  minimal and marked with `// clody:` comments.
- Upstream is cherry-picked monthly, never tracked daily.

## Layout
- `packages/clody-core`    — probe, model profiles, Ollama lifecycle, config, agent generator
- `packages/clody-cli`     — the `clody` bin: ensure Ollama → probe → generate config → launch TUI
- `packages/clody-context` — retrieval, memory, skill routing, loop-breaking for small context windows
- `packages/clody-bench`   — local-model agent benchmark harness

## Local-model tuning

See [CLODY-TUNING.md](CLODY-TUNING.md) for the living context doc: mission (beat
MiMo for local models), verified per-model tool-calling facts, failure modes +
fixes, the config/env knob reference, and the prioritized harness roadmap.
