# AutoApply — Demo Documentation

A hosted demo of a vision-driven AI agent that fills and submits real job applications on Lever, Greenhouse, and Ashby.

The demo's pitch is the **live browser session embedded directly in the UI**. You watch a real Chromium instance in the cloud fill every field of a real application form while a streaming event log narrates what the agent is doing. When the agent clicks submit, you get a screenshot receipt.

---

## Documentation

| Doc | What's in it |
|---|---|
| [01 — Vision](./01-vision.md) | What we're building, who it's for, what success looks like |
| [02 — Features & Rationale](./02-features.md) | Each feature, why it exists, what it deliberately doesn't do |
| [03 — Architecture (HLD)](./03-architecture-hld.md) | High-level diagram, the three core components, request flow |
| [04 — Architecture (LLD)](./04-architecture-lld.md) | File map, data shapes, code paths, key algorithms |
| [05 — Tech Stack](./05-tech-stack.md) | Stack choices and why we reversed parts of the original plan |
| [06 — Setup & Running](./06-setup.md) | Env vars, install, dev server, the W0 spike script |

---

## TL;DR

- **What:** Drop résumé → paste job URL → watch agent fill + submit live → get receipt.
- **Why this exists as a demo first, SaaS later:** the wow moment is unmistakable when you see the live browser working. Build the spike that proves the concept; the business model can follow.
- **What it isn't:** not a SaaS. No auth, no payments, no usage caps, no dashboards, no analytics, no rate limiting. One user (you) at a time. By design — see [02 — Features](./02-features.md) for what's deferred and why.
- **Stack:** Next.js 16 (App Router) + Stagehand v3 + Steel.dev + Claude Haiku 4.5. One Node process. No database, no Redis.
- **State:** all in-memory. Refresh mid-run = run is lost. Acceptable for demo.
