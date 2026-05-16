# 05 — Tech Stack

## Final stack (as built, May 2026)

| Layer | Choice | Version | Why |
|---|---|---|---|
| Framework | Next.js (App Router, React 19, Turbopack) | 16.2.6 | Latest stable. One deploy, server + client + API routes. |
| Styling | Tailwind v4 + shadcn/ui + Motion | v4 / latest / 12.x | Tailwind v4 is the May 2026 default. Shadcn primitives only. Motion (formerly Framer Motion) for spring transitions. |
| Fonts | Fraunces (display), Inter (sans), JetBrains Mono | via `next/font/google` | Display serif + monospace gives the "not generic AI" look. |
| Agent runtime | `@browserbasehq/stagehand` v3 | 3.4.0 | Uses Chrome Accessibility Tree (small payload, reliable matching), server-side `act()` caching, native PDF upload via Playwright. |
| Cloud browser | `steel-sdk` | 0.18.0 | 100 hr/mo free tier vs Browserbase 1 hr. `sessionViewerUrl` is the embedded iframe. |
| LLM (default) | Claude Haiku 4.5 via `@anthropic-ai/sdk` | 0.96.0 | $1/$5 per 1M tokens. Cache-friendly. Used for both PDF parsing and agent reasoning. |
| LLM (alt) | Gemini 3 Flash via Stagehand AI SDK adapter | optional dep | UI toggle on Confirm screen lets user run the same posting with Gemini and compare. |
| Validation | Zod | 4.4.3 | Strict shape validation on both Anthropic tool output and `/api/start` body. |
| Hosting (target) | Railway | n/a | No function timeout, auto-deploy from GitHub. (Not deployed yet — runs locally during build-out.) |
| Errors | Console logs only | — | One user, watching the terminal. No Sentry yet. |

## What we chose against, and why

These are the active stack reversals from the founder's original committed plan (documented in [the plan file](../../../.claude/plans/autoapply-saas-lexical-liskov.md)):

### `browser-use` (Python) — rejected

The original pitch was browser-use + Playwright + Sonnet 4.5. We reviewed it and switched to Stagehand v3 because:

- Stagehand v3 also uses the Chrome Accessibility Tree (the main reason to like browser-use).
- Stagehand has fixed combobox bugs on ARIA combobox patterns (issue #3694 on browser-use) — exact pattern Greenhouse / Ashby country pickers use.
- Stagehand cloud has server-side `act()` caching, so the second applicant to the same posting costs near-zero LLM tokens.
- TypeScript end-to-end = one repo, one runtime, faster iteration for a 2-weekend demo.

We can still A/B against browser-use by writing a thin adapter; not currently in scope.

### Claude Sonnet 4.5 — retired model

Sonnet 4.5 is retired as of May 2026. Current options are Haiku 4.5 ($1/$5 per 1M) and Sonnet 4.6 ($3/$15 per 1M). Haiku 4.5 hits the $0.10/app budget with room. Sonnet 4.6 is the documented escalation path for hard fields; not used by default.

### Browserbase — too small free tier

Browserbase: 1 free browser-hour. Steel.dev: 100 free browser-hours. For a demo we'll burn through Browserbase's quota in 20 runs. Steel is the better starting point.

Stealth benchmarks: both Steel and Browserbase land at ~42–47%. **Anchor Browser** scores 77% but is paid. If a target ATS starts blocking, the escape hatch is Anchor — single file change in `src/lib/agent/steel.ts`.

### `@ai-sdk/google` (Gemini) — supported as opt-in, not default

We added the UI toggle on user request. Why not default?

- Anthropic PDF input is required for résumé parsing (best structured-output tool support). Gemini doesn't replace this, so we'd still need Anthropic.
- Stagehand's full feature set (caching, act-replay) was originally tuned for Claude/OpenAI; Gemini support exists but is newer.
- Haiku 4.5 is cheaper for our token shape.

The toggle is the right thing for a demo where you want to show "model-agnostic" — and lets us verify Gemini's quality without committing.

### Native macOS menu bar app — deferred ("good to have")

Requested by the founder, then de-prioritized. We're skipping it for now because:

- A **Chrome extension** that detects supported ATS URLs and posts to `/api/start` does ~90% of the same job for ~20% of the effort, and works cross-OS.
- A native tray app's only unique value is the global hotkey, which only matters when the browser isn't focused — but we're applying to a job page, which IS focused.
- Founder develops on Windows 11; iterating on Swift requires a Mac round-trip.

If we revisit: target Swift + NSStatusItem + AppleScript-based active-tab URL fetch + HotKey library, ~150 lines, 1 weekend. Documented in [02 — Features](./02-features.md) under deferred.

### FastAPI + Celery + Redis — never written

Original plan called for this; never built. The single-Node-process design is enough for the demo. If we go SaaS, the recommended replacement is Modal (Python runtime + queue, scale-to-zero), not Celery/Redis.

### Clerk, Stripe, Supabase Auth, Supabase Postgres — none of them

None of these are in the demo. All state is in-memory. When we go SaaS, the documented baseline is Supabase Auth + Postgres + Modal — keep Stripe.

## Environment

- **Node:** 22.x (Stagehand requires `^20.19 || >=22.12`)
- **Package manager:** npm (per Stagehand's docs default and the scaffold flags)
- **Module type:** ESM (Next.js 16 default)
- **TypeScript:** strict
- **Bundler:** Turbopack (Next.js 16 default)

## Total dependency surface

```text
Production (dependencies):
  @anthropic-ai/sdk        # PDF input + tool use
  @browserbasehq/stagehand # agent runtime
  steel-sdk                # cloud browser provider
  next, react, react-dom   # framework
  zod                      # validation
  motion                   # animations
  shadcn/* + lucide-react  # UI primitives
  class-variance-authority # shadcn variants
  clsx + tailwind-merge    # cn() helper
  tailwindcss              # styling
  tailwindcss-animate      # legacy shadcn animations
  sonner                   # toasts
  tsx                      # spike script runner

Dev:
  typescript, eslint, @types/*
```

No DB driver, no Redis client, no queue lib, no auth lib.

## Known gotchas baked in

- **Stagehand peer deps:** `playwright-core` is an optional peer dep — we install it explicitly.
- **`disablePino: true`:** Stagehand's default Pino logger interleaves with our event stream noise; we shut it off.
- **`as never` cast on model name:** Stagehand v3's `AvailableModel` is a union of fixed strings + `string`. The cast keeps TypeScript quiet without losing type safety on env vars.
- **`process.env` at module scope:** the `MODEL_CHOICES` map is in a file shared between client and server. We hardcode display strings there; env reads happen only inside the server-only `runner.ts`.
- **`set_input_files` bypass:** Stagehand uses Playwright's locator API, so file uploads bypass the LLM entirely. Without this, Claude/Gemini would try to "click" the file dialog, which doesn't work.
