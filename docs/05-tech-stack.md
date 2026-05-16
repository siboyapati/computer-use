# 05 — Tech Stack

This is the running stack as built. For why we *reversed* the founder's original picks (browser-use → Stagehand, Sonnet 4.5 → Haiku 4.5, etc.), see the bottom section.

---

## Web app

| Layer | Choice | Version | Why |
|---|---|---|---|
| Framework | Next.js (App Router, React 19, Turbopack) | 16.2.6 | Latest stable. One deploy, server + client + API routes. |
| UI | Tailwind v4 + shadcn/ui + Motion | v4 / latest / 12.x | Tailwind v4 is the May 2026 default. shadcn primitives only. Motion (ex-Framer) for spring transitions. |
| Theme | Light by default (warm off-white + olive accent), `.dark` palette preserved for future toggle | — | The `<html>` element does NOT carry a `dark` class. `globals.css` defines both palettes via CSS variables; switching is a one-line class flip. |
| Fonts | Fraunces (display) + Inter (sans) + JetBrains Mono | via `next/font/google` | Display serif + monospace avoids the "Inter everywhere" AI-demo look. |
| Agent runtime | `@browserbasehq/stagehand` v3 | 3.4.0 | Chrome Accessibility Tree, server-side `act()` caching, native `setInputFiles` via Playwright. |
| Cloud browser | `steel-sdk` | 0.18.0 | 100 free browser-hrs/mo. `debugUrl` (with `?interactive=true`) is the embedded iframe. |
| LLM (default) | Claude Haiku 4.5 (`claude-haiku-4-5`) via `@anthropic-ai/sdk` | 0.96.0 | $1 / $5 per 1M. Cache-friendly. PDF input for résumé parsing. |
| LLM (alt) | Gemini 3 Flash (`google/gemini-3-flash-preview`) via Stagehand's AI SDK adapter | optional | UI toggle on Confirm screen for A/B comparison. |
| Validation | Zod | 4.4.3 | Strict shape validation on Anthropic `tool_use` output + `/api/start` body. |
| Storage (client) | `localStorage` | — | Résumé + last 5 runs survive refresh. |
| Storage (server) | none | — | All run state in-memory, by design. |
| Hosting | Railway | — | No function-duration cap (Vercel's 5min cap is tight for some real ATS fills). |
| Errors | Console logs only | — | Single user, watching the terminal. No Sentry yet. |

## Chrome extension (`extension/`)

| Layer | Choice | Version | Why |
|---|---|---|---|
| Framework | Plasmo | 0.90.5 | TS-native, hot reload, auto-generates Manifest V3 from `popup.tsx` / `options.tsx` / `background.ts` / `contents/*.ts` file conventions. |
| UI | Tailwind v3 | 3.4.18 | Plasmo doesn't yet support Tailwind v4's Vite-only pipeline. v3 + PostCSS works clean. |
| Fonts | Fraunces (display) loaded from Google Fonts via `@import` in styles.css | — | Matches web app's display font. |
| Content script | Vanilla TS + Shadow DOM | — | Smaller bundle (~8.5 KB minified) vs React in content scripts. Shadow DOM avoids CSS conflicts with ATS pages. |
| Storage | `chrome.storage.local` | — | ~10 MB quota; holds résumé JSON + PDF base64 + apiBase. |
| Web↔extension messaging | `externally_connectable` + `chrome.runtime.sendMessage` | — | Clean Chrome API for `/connect` → service worker handoff. No tokens, no temp server records. |
| Browser support | Chromium-based (Chrome, Edge, Brave, Arc) | — | MV3 support in Firefox is still uneven. |

## Plasmo manifest (auto-generated)

```jsonc
{
  "manifest_version": 3,
  "name": "AutoApply — One-click apply",
  "permissions": ["storage", "tabs", "activeTab"],
  "host_permissions": [
    "https://*.lever.co/*",
    "https://*.greenhouse.io/*",
    "https://*.ashbyhq.com/*",
    "http://localhost:3000/*"
  ],
  "externally_connectable": {
    "matches": [
      "http://localhost:3000/*",
      "http://127.0.0.1:3000/*",
      "https://autoapply.com/*"
    ]
  },
  "content_scripts": [{
    "matches": ["https://*.lever.co/*", "https://*.greenhouse.io/*", "https://*.ashbyhq.com/*"],
    "js": ["overlay.<hash>.js"],
    "run_at": "document_idle"
  }],
  "action": { "default_popup": "popup.html" },
  "options_ui": { "page": "options.html", "open_in_tab": true },
  "background": { "service_worker": "static/background/index.js" }
}
```

---

## Why these picks (vs the original plan)

The founder's first stack draft committed to `browser-use` + Sonnet 4.5 + Browserbase + FastAPI + Celery + Redis + Clerk + PostHog. We reversed most of it. The reasoning is durable enough to write down so we don't re-litigate.

### `browser-use` (Python) → **Stagehand v3 (TypeScript)**

- Stagehand v3 also uses the Chrome Accessibility Tree (which is the main reason to like browser-use).
- Stagehand has fixed combobox bugs (`browser-use` issue #3694) on the exact ARIA pattern Greenhouse / Ashby country pickers use.
- Stagehand cloud has server-side `act()` caching → near-zero LLM cost on repeat applicants to the same posting.
- Same language as the web app → one repo, one runtime, faster iteration for a 2-weekend demo.

### Claude Sonnet 4.5 → **Haiku 4.5 default, Sonnet 4.6 escalation**

- Sonnet 4.5 is retired.
- Haiku 4.5 at $1 / $5 per 1M hits the < $0.10/app budget with room.
- Sonnet 4.6 is documented as the escalation path for hard fields but isn't used by default.

### Browserbase → **Steel.dev**

- 100 free browser-hours vs Browserbase's 1.
- Stealth benchmarks: Steel and Browserbase both land at ~42–47%. Anchor Browser scores 77% — switch to Anchor if blocking persists. One-file change in [steel.ts](../src/lib/agent/steel.ts).

### `@ai-sdk/google` (Gemini) — **opt-in toggle, not default**

- Anthropic PDF input is required for résumé parsing (best structured-output tool support). Gemini doesn't replace this.
- Stagehand was originally tuned for Claude/OpenAI; Gemini support is newer.
- The toggle is the right thing for a demo where you want to show "model-agnostic" — and lets us verify Gemini's quality without committing.

### Native macOS menu bar app → **deferred (good to have)**

The Chrome extension covers ~90% of the same job for ~20% of the effort, cross-OS. The native app's only unique value is the global hotkey, which doesn't help on a focused browser tab. Documented in [02 — Features](./02-features.md#deferred-considered-not-built).

### FastAPI + Celery + Redis → **never written**

For a single-Node-process demo, this layer would be entirely overhead. If we go SaaS, the recommended replacement is **Modal** (Python runtime + queue, scale-to-zero), not Celery/Redis.

### Clerk + Stripe + Supabase Auth + Supabase Postgres → **none of them**

The demo is single-user, no payments, no accounts. When we go SaaS, the documented baseline is Supabase Auth + Postgres + Modal — keep Stripe.

---

## Environment

- **Node:** 22.x (Stagehand requires `^20.19 || >=22.12`).
- **Package manager:** npm in both `./` and `./extension/`.
- **Module type:** ESM (Next.js 16 default).
- **TypeScript:** strict, with `paths: { "@/*": ["./src/*"] }` in the web app and `paths: { "~*": ["./src/*"] }` in the extension.
- **Bundler:** Turbopack (Next.js 16 default) for the web app; Plasmo (Parcel-based) for the extension.

---

## Total dependency surface

### Web app deps

```text
Production:
  @anthropic-ai/sdk          # PDF input + tool use
  @browserbasehq/stagehand   # agent runtime
  steel-sdk                  # cloud browser provider
  next + react + react-dom   # framework
  zod                        # validation
  motion                     # animations
  shadcn primitives + lucide-react  # UI
  class-variance-authority + clsx + tailwind-merge  # cn() + variants
  tailwindcss + tw-animate-css      # styling
  sonner                     # toasts
  playwright-core            # Stagehand peer dep
  tsx                        # spike script runner

Dev:
  typescript + eslint + @types/*
```

### Extension deps

```text
Production:
  lucide-react
  plasmo
  react + react-dom

Dev:
  @types/chrome + @types/node + @types/react + @types/react-dom
  autoprefixer + postcss + tailwindcss (v3)
  typescript
```

No DB driver, no Redis client, no queue lib, no auth lib anywhere.

---

## Gotchas baked in

- **Plasmo doesn't merge custom `manifest.action`** — if you set `"action": { ... }` in `package.json`'s `manifest` block, Plasmo *replaces* the auto-generated action (which contains `default_popup`). Leave `action` out of your manifest and let Plasmo write it from the existence of `popup.tsx`.
- **CSS `@import` must come before `@tailwind`** — Plasmo's PostCSS pass fails with "@import rules must precede all rules" otherwise.
- **Web app's `tsconfig.json` must exclude `extension/`** — otherwise `next build` types fail with `Cannot find module '~lib/storage'` (Plasmo's path alias isn't in the root config).
- **`disablePino: true`** on Stagehand kills its log noise that would otherwise interleave with our `emit()` output.
- **`as never` cast on `modelName`** — Stagehand v3's `AvailableModel` type is a string union; the cast keeps TypeScript quiet without losing safety on env var values.
- **`set_input_files` bypass** — Stagehand uses Playwright's locator API, so file uploads bypass the LLM entirely. Without this, the agent would try to "click" the file dialog, which doesn't work.
- **`externally_connectable` is in the extension's manifest, not the web app's** — it specifies which *origins* are allowed to send messages to the extension.
- **Plasmo dev-build extension IDs are random per install** — we work around this by passing `ext_id` as a URL parameter to `/connect`, so the web app doesn't need to know it ahead of time.
