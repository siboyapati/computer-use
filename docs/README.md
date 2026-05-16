# AutoApply — Documentation

AutoApply is a vision-driven AI agent that fills and submits real job applications on Lever, Greenhouse, and Ashby. It ships as a **web app** (drop résumé, paste URL, watch agent fill) and a **Chrome extension** (one-click apply directly from a job page).

This documentation is organized to be read in order if you're new, or jumped into if you're looking up a specific feature.

---

## Reading order for newcomers

| Doc | What's in it |
|---|---|
| [01 — Vision](./01-vision.md) | The pitch, the audience, what success looks like |
| [02 — Features overview](./02-features.md) | What's in scope, what's deferred, and why |
| [03 — Architecture (HLD)](./03-architecture-hld.md) | System diagram + request flow at a glance |
| [04 — Architecture (LLD)](./04-architecture-lld.md) | File map, code paths, key algorithms |
| [05 — Tech stack](./05-tech-stack.md) | Every dependency choice + why |
| [06 — Setup & running](./06-setup.md) | Install, env, dev loop, smoke tests |

---

## Deep-dive: one doc per feature

Each file in [`features/`](./features/) covers a single feature end-to-end: what it does, why it exists, the code path, gotchas, and how to verify it.

- [Résumé parser](./features/resume-parser.md) — PDF → strict JSON via Claude's PDF input
- [Agent runner](./features/agent-runner.md) — Stagehand + Steel orchestration
- [Field mapping](./features/field-mapping.md) — deterministic dictionary → EEO heuristics → LLM fallback
- [ATS adapters](./features/ats-adapters.md) — per-platform extraction + upload + submit
- [Live browser stream](./features/live-stream.md) — Steel iframe + SSE event log
- [Review-before-submit + Stop](./features/review-mode.md) — pause control, Submit-for-real button, abort
- [Model toggle (Claude / Gemini)](./features/model-toggle.md) — runtime LLM choice
- [Persistence (résumé + run history)](./features/persistence.md) — localStorage
- [Chrome extension](./features/chrome-extension.md) — one-click apply from any supported job page

---

## Reference

Strict contracts and shapes — what to look up, not what to read top to bottom.

- [API routes](./reference/api.md) — every endpoint with request/response shapes
- [Type definitions](./reference/types.md) — `Resume`, `AgentEvent`, `RunMetadata`, etc.
- [Environment variables](./reference/env.md) — required + optional, web app + extension

---

## TL;DR

- **Stack:** Next.js 16 + React 19 + Tailwind v4 + shadcn/ui + Motion + Stagehand v3 + Steel.dev + Claude Haiku 4.5 (default) / Gemini 3 Flash (toggle) + Plasmo (extension).
- **State:** all in-memory in a single Node process. No DB, no Redis, no queue.
- **Defaults:** review-before-submit ON (agent fills, you click Submit). Anthropic provider. Lever/Greenhouse/Ashby only.
- **Out of scope:** auth, payments, multi-user, dashboards, Workday support. See [02 — Features](./02-features.md) for the full deferred list.

---

## Updating these docs

If you change a feature, update its file in `features/` first. The top-level docs (01–06) summarize; they reference the deep-dives via links. If you add a new feature, create a new file in `features/` and link it from this README and [02 — Features](./02-features.md).
