# Features — Deep Dives

One file per feature. Each follows the same structure:

1. **What** — one-line description.
2. **Why** — the problem this solves and why we chose this approach.
3. **How** — the code path, files involved, key algorithms.
4. **Gotchas** — what's deliberately not handled, edge cases, common failure modes.
5. **Verification** — how to manually smoke-test this feature end-to-end.

If you change a feature, update its file here *first*. The top-level docs (`01-vision.md` through `06-setup.md`) summarize and link back to these.

---

## Core agent surface

- [Résumé parser](./resume-parser.md) — PDF → strict JSON in one Claude call
- [Agent runner](./agent-runner.md) — Stagehand + Steel orchestration
- [Field mapping](./field-mapping.md) — Deterministic → EEO heuristic → LLM fallback
- [ATS adapters](./ats-adapters.md) — Per-platform extract / upload / submit
- [Live browser stream](./live-stream.md) — Steel iframe + SSE event log

## User controls

- [Review-before-submit + Stop](./review-mode.md) — pause control, Submit-for-real, abort
- [Model toggle (Claude / Gemini)](./model-toggle.md) — runtime LLM choice

## State + history

- [Persistence (résumé + run history)](./persistence.md) — localStorage

## Chrome extension

- [Chrome extension](./chrome-extension.md) — full extension architecture, pairing, content script, popup, options
