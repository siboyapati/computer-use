# 02 — Features Overview

Every feature currently in the codebase, ranked roughly by user-visible impact. Each one has a deep-dive doc in [`features/`](./features/) — this file is the **map**, not the manual.

A "deferred" list at the bottom records what we considered and consciously didn't build, with the reasoning.

---

## In scope (built and shipping)

### Core agent surface

| Feature | One-line | Deep dive |
|---|---|---|
| **Résumé parser** | PDF → strict JSON in one Claude call (PDF input + `tool_use`). | [resume-parser.md](./features/resume-parser.md) |
| **Agent runner** | Stagehand v3 + Steel.dev cloud browser orchestration; navigates, fills, submits, screenshots. | [agent-runner.md](./features/agent-runner.md) |
| **Field mapping** | Deterministic dictionary → EEO heuristics → LLM fallback, with prompt-caching. EEO never auto-picks a real demographic answer. | [field-mapping.md](./features/field-mapping.md) |
| **ATS adapters** | Per-platform extraction + file-upload + submit, with deterministic CSS selectors before LLM `act()` fallback. | [ats-adapters.md](./features/ats-adapters.md) |
| **Live browser stream** | Steel `sessionViewerUrl` iframed + SSE event log → user watches the agent in real time. SSE handler removes listeners on disconnect. | [live-stream.md](./features/live-stream.md) |
| **Try with sample résumé** | A built-in synthetic résumé + PDF ship in `public/sample-resume.pdf`. Landing CTA loads them instantly — no API call, no Anthropic cost. | [persistence.md](./features/persistence.md#sample-r%C3%A9sum%C3%A9) |

### User controls

| Feature | One-line | Deep dive |
|---|---|---|
| **Settings page (BYO keys)** | `/settings` page on web + Keys section in extension options. Per-key Save + Test buttons. Keys stored in `localStorage` / `chrome.storage.local` and shipped per-request. Env vars are fallbacks. | [keys-settings.md](./features/keys-settings.md) |
| **User profile + auto-learn** | A persistent profile of structured "extras" (work auth, salary, start date) + a learned-answers dictionary keyed by normalized question hash. Field-mapper consults both before falling to the LLM — zero tokens on repeat questions. Auto-populated when the user answers a skipped field in review mode. | [profile-learning.md](./features/profile-learning.md) |
| **Skipped-required inline edit** | Required fields the agent couldn't answer become editable rows in the review-mode footer. "Save & fill" persists the answer to the profile AND injects a `stagehand.act()` into the running session via `/api/fill/[runId]`. | [profile-learning.md](./features/profile-learning.md) |
| **Review-before-submit** | Default ON. Agent fills + uploads, then pauses. User clicks "Submit for real". | [review-mode.md](./features/review-mode.md) |
| **Stop button** | Mid-run abort. `POST /api/stop/[runId]` flips a flag; runner checks between steps. | [review-mode.md](./features/review-mode.md) |
| **Submit-for-real button** | While in review mode, the user clicks this to release the pause and let the agent submit. | [review-mode.md](./features/review-mode.md) |
| **Model toggle** | Runtime switch between Claude Haiku 4.5 and Gemini 3 Flash for the agent. | [model-toggle.md](./features/model-toggle.md) |
| **Résumé persistence** | Parsed résumé survives refresh via `localStorage`. "Use last résumé" CTA on landing. | [persistence.md](./features/persistence.md) |
| **Run history** | Last 5 finished runs stored locally with screenshot thumbnails. Strip on the landing page. | [persistence.md](./features/persistence.md) |
| **Apply-to-another** | Celebration modal's primary action keeps the résumé, only clears the URL. | [persistence.md](./features/persistence.md) |
| **Deep linking** | `/?runId=X` opens straight into LiveRun mode. Used by the extension and shareable links. | [chrome-extension.md](./features/chrome-extension.md#deep-linking) |

### Chrome extension

| Feature | One-line | Deep dive |
|---|---|---|
| **Floating apply button** | Content script injects a glass button on every Lever/GH/Ashby posting. | [chrome-extension.md](./features/chrome-extension.md) |
| **Toolbar popup** | Extension icon shows status + résumé preview + a contextual "Apply to this Lever job" CTA when on a posting. | [chrome-extension.md](./features/chrome-extension.md) |
| **One-time pairing** | `/connect?ext_id=<id>` page on the web app pushes the résumé into the extension via `externally_connectable`. | [chrome-extension.md](./features/chrome-extension.md) |
| **Options page** | Polished Tailwind UI: connect / re-pair / disconnect, server URL config, résumé summary. | [chrome-extension.md](./features/chrome-extension.md) |

### Infrastructure

| Feature | One-line | Deep dive |
|---|---|---|
| **CORS layer** | Permissive CORS on all routes the extension calls. | [reference/api.md](./reference/api.md) |
| **SSE events** | `text/event-stream` from in-memory pub/sub keyed by `runId`. | [features/live-stream.md](./features/live-stream.md) |
| **In-memory pub/sub + run prune** | `Map<runId, { meta, emitter, log }>` + 5-min interval cleanup. | [features/agent-runner.md](./features/agent-runner.md#run-lifecycle) |
| **Resume PDF cleanup** | Temp PDFs deleted in `runner.ts`'s `finally`. | [features/agent-runner.md](./features/agent-runner.md) |
| **Cost cap** | Per-run hard cap of 40 fields filled; Workday URLs hard-blocked via `detectATS`. | [features/field-mapping.md](./features/field-mapping.md) |

---

## Default behaviors worth knowing

- **Theme**: light by default (warm off-white background, charcoal text, olive-chartreuse accent). The `.dark` class palette is preserved in `globals.css` for a future toggle but isn't applied at the `<html>` root.
- **EEO / demographic fields**: agent picks the first option matching `/decline|prefer not|do not wish|don.?t wish|rather not|not.*say|wish.*disclose/i`. **If no decline-style option exists, the field is left blank** (privacy: never auto-picks a real demographic answer like "Black or African American").
- **File uploads**: agent uses Playwright's `setInputFiles` — bypasses the LLM entirely for file dialogs.
- **Resume upload size**: 5 MB max (Anthropic PDF input limit). Enforced at `/api/parse-resume`.
- **Submit button selection**: deterministic CSS/XPath first (`button[type="submit"]`, `xpath=//button[contains(., "submit")]`); `stagehand.act()` only as fallback.
- **Workday**: hard-blocked. `detectATS` returns `null` and `/api/start` rejects. Reason: 10+ page paginated forms blow the token budget, plus heavy bot detection.
- **Per-run field cap**: 40 fields. Anything more is treated as a malformed form and skipped with a logged error.

---

## Deferred (considered, not built)

Each line is a feature someone could ask for. The "why not" is the artifact that prevents us from re-litigating.

| Feature | Why not |
|---|---|
| Auth / accounts | Single user (the founder). Auth adds friction to a demo that should be one click. Pair-and-trust on the extension. |
| Stripe / payments | No customers to charge yet. Demo is the validator. |
| Rate limiting / cost cap per IP | Single user. Founder watches the bill. Per-run field cap covers the worst case. |
| Application history (server-side) | All run state in-memory by design. History on the client (localStorage) is enough for one user. |
| Cover-letter generation | Single Claude call would add it. Defer to v2 — not core to the wow moment. |
| Workday support | Cost runaway + bot detection + 10+ paginated pages. Hard-blocked. |
| Multi-résumé support | Only one paired résumé. Adding "tech vs PM" requires a picker UI and storage rework. v2. |
| Firefox / Safari extension | Chromium only for v1. MV3 support in Firefox is still rocky. |
| Native macOS menu bar app | A Chrome extension covers 90% of the value for 20% of the effort. The native app's only unique value is the global hotkey, which doesn't help on a focused browser tab. |
| PostHog / analytics | One user. No funnel to analyze. Vercel Analytics later if needed. |
| Sentry | Console logs are enough at this scale. |
| Application scoring / "good fit" detection | Out of scope. Extension knows host pattern, not job-fit semantics. |
| Resume editing inside the extension | The web app is the source of truth; the extension is a trigger. |

---

## What "done" looks like for each in-scope feature

Each feature's deep-dive doc has its own "verification" section, but the high-level bar:

- **Résumé parser**: any standard PDF returns a `Resume` object passing Zod validation.
- **Agent runner**: real Lever / Greenhouse / Ashby URL → real submitted application + screenshot.
- **Live stream**: from page load to "Submitted" confetti, the user has a continuous visual narrative.
- **Chrome extension**: drop résumé on web app → pair extension → open job page → floating button → new tab → live stream.
- **Review-before-submit**: agent fills all fields, pauses, "Submit for real" sends the click.
- **Stop**: clicking Stop within ~2 seconds halts the run.
- **Model toggle**: switching Claude → Gemini on the Confirm screen runs the same fill flow with the alternate model.
- **Persistence**: full browser refresh → user is still set up; recent runs visible.
