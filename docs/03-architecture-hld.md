# 03 — Architecture (High-Level Design)

## One-paragraph summary

A single Next.js process on Railway hosts the web UI, the API routes, and the agent runner. The UI walks the user through three states (Landing → Confirm → LiveRun) and subscribes via Server-Sent Events to an in-memory pub/sub keyed by `runId`. The runner spawns a Stagehand session against a Steel.dev cloud Chromium and drives the form fill, emitting events at every step. The Steel session's `liveUrl` is embedded in the page via `<iframe>` so the user watches the agent live. A Chrome extension (built with Plasmo) is a second client: it injects an inline "One-click apply with AutoApply" button beside the native ATS Apply button and hands off to the same `/api/start` endpoint after a one-time résumé-pairing handshake. No database, no Redis, no queue.

---

## System diagram

```text
              ┌────────────────────────────────────────────────────────────┐
              │                       Web app (Next.js)                    │
              │                                                            │
              │   src/app/page.tsx — reducer-driven 3-state UI             │
              │     • Landing        ─→ POST /api/parse-resume             │
              │     • Confirm        ─→ POST /api/start                    │
              │     • LiveRun        ─→ GET  /api/events/:runId  (SSE)     │
              │                        POST /api/stop/:runId               │
              │                        POST /api/submit-now/:runId         │
              │                                                            │
              │   /connect             — extension pairing handshake       │
              │   /?runId=<id>         — deep-link into LiveRun            │
              │                                                            │
              │   src/app/api/                                             │
              │     parse-resume   → Anthropic PDF input → strict JSON     │
              │     start          → creates runId, fires agent async      │
              │     events/[id]    → SSE stream of agent events            │
              │     runs/[id]      → GET meta for hydrate-on-load          │
              │     stop/[id]      → flips stop flag                       │
              │     submit-now/[id]→ flips submit flag in review mode      │
              │                                                            │
              │   src/lib/agent/                                           │
              │     runner.ts      — Stagehand orchestration               │
              │     adapters/{lever,greenhouse,ashby}.ts                   │
              │     field-mapper.ts                                        │
              │     events.ts      — in-memory pub/sub Map<runId,…>        │
              └──────────────────────────────────┬─────────────────────────┘
                                                 │
                          (CDP WebSocket: stagehand.init with cdpUrl)
                                                 ▼
                          ┌─────────────────────────────────────────┐
                          │      Steel.dev cloud Chromium session   │
                          │  • websocketUrl     (Stagehand connects)│
                          │  • debugUrl (iframed in LiveRun)        │
                          └─────────────────────────────────────────┘
                                                 │
                                                 ▼
                          ┌─────────────────────────────────────────┐
                          │   ATS application page                  │
                          │   (Lever / Greenhouse / Ashby)          │
                          └─────────────────────────────────────────┘


  Chrome extension (Plasmo, separate package in extension/):
  ───────────────────────────────────────────────────────────
       ┌──────────────────────────────┐
       │ Lever / GH / Ashby job page  │
       │  content script overlay.ts   │
       │  injects inline apply CTA    │
       └──────────────┬───────────────┘
                      │ click
                      ▼
       ┌──────────────────────────────┐
       │  background.ts (SW)          │
       │   reads stored résumé        │
       │   POST /api/start            │
       │   chrome.tabs.create(        │
       │     `${api}/?runId=<id>`)    │
       └──────────────┬───────────────┘
                      │ new tab
                      ▼
       ┌──────────────────────────────┐
       │  Web app reads ?runId=,      │
       │  hydrates via GET /api/runs, │
       │  subscribes to SSE,          │
       │  renders existing LiveRun.   │
       └──────────────────────────────┘
```

---

## The 5 core components

### 1 · Résumé Parser

PDF → strict `Resume` JSON via Anthropic's PDF input + `tool_use`. One API call, no PDF parsing library. Returns `{ resume, pdfBase64 }` so the PDF round-trips back to the client and rides along on subsequent `/api/start` requests without server-side storage.

Deep dive: [features/resume-parser.md](./features/resume-parser.md).

### 2 · Agent Runner

The orchestrator. Picks the model based on `provider`, opens a Steel session, hands the CDP URL to Stagehand, drives the per-ATS adapter through extract → fill → upload → (optional pause for review) → submit → screenshot. Emits events to the in-memory pub/sub at every step. Handles stop and submit-now control flags. Cleans up Steel sessions + temp PDF files in `finally`.

Deep dive: [features/agent-runner.md](./features/agent-runner.md).

### 3 · Live UI

Three states, one page, no router. State 1 is the drop zone. State 2 shows the parsed résumé as a glassy card with URL input + model toggle + review-mode toggle. State 3 is the hero: split layout with the Steel iframe on the left, a streaming event log on the right, a phase strip on top, and Stop / Submit-for-real buttons in the header.

Deep dive: [features/live-stream.md](./features/live-stream.md).

### 4 · Persistence (client-only)

`localStorage` carries the parsed résumé and the last 5 finished runs (with screenshot thumbnails) so a browser refresh doesn't wipe state. There is **no server-side persistence** — the demo is single-user and stateless.

Deep dive: [features/persistence.md](./features/persistence.md).

### 5 · Chrome Extension

A separate Plasmo package in `extension/`. Pairs with the web app once (résumé pushed via `chrome.runtime.sendMessage` from the `/connect` page), then injects an inline AutoApply button and a compact dock on every Lever/Greenhouse/Ashby posting. The background service worker calls `/api/start` with the stored résumé + the page's URL and opens a new tab pointing at `/?runId=X`.

Deep dive: [features/chrome-extension.md](./features/chrome-extension.md).

---

## Request flow (happy path, web app)

1. **Drop résumé** → `POST /api/parse-resume` → Claude PDF input + tool use → strict JSON returned + base64 PDF.
2. **Paste URL + click Start** → `POST /api/start` with `{ resume, pdfBase64, jobUrl, provider, reviewMode }`.
3. Server creates `runId`, registers an in-memory `EventEmitter`, fires `runApplication(...)` *without awaiting* (long-running, runs in the same process).
4. Server polls for the Steel `liveUrl` for up to 8 seconds, then returns `{ runId, liveUrl, ats }`.
5. Client jumps to phase `"live"` and opens `new EventSource('/api/events/<runId>')`.
6. The SSE handler replays any events already emitted (so the run won't miss what happened during the 8s wait), then pipes new events. Each event is `event: agent` + `data: { ... }`; meta updates come as `event: meta`.
7. Runner navigates, extracts fields, fills each one (deterministic match → EEO privacy guard → profile extras/saved answers → LLM fallback), uploads the résumé via `setInputFiles`, and either submits immediately or pauses if `reviewMode` was true.
8. On review-mode pause: status flips to `awaiting_review`. User clicks **Submit for real** → `POST /api/submit-now/:runId` → flag flips → runner proceeds.
9. Screenshot captured + emitted as `data:image/png;base64,…` in the meta, run finishes, confetti modal renders.

## Request flow (Chrome extension)

1. Extension already paired (one-time `/connect` handshake — see [features/chrome-extension.md](./features/chrome-extension.md#pairing)).
2. User loads a Lever/GH/Ashby posting. Content script `overlay.ts` checks storage, sees pairing, injects the inline apply CTA and dock.
3. User clicks → `chrome.runtime.sendMessage({ type: "apply", jobUrl })` to the service worker.
4. Service worker `POST ${apiBase}/api/start` with the stored résumé and `reviewMode: true`.
5. Receives `{ runId, liveUrl, ats }`, opens `chrome.tabs.create({ url: '${apiBase}/?runId=${runId}' })`.
6. The new tab is just the web app with a deep-link param. The web app's `useEffect` on mount reads `?runId=`, fetches `GET /api/runs/:runId` for meta, dispatches `STARTED`, and the rest of the flow is identical to the web app path.

---

## Why this shape

- **One Node process, no queue.** Single-user, in-memory pub/sub is fast and trivial. Adding Redis would buy us nothing yet.
- **SSE over WebSocket.** Auto-reconnects, works through proxies, no Next.js special handling — just a `ReadableStream` in the route handler.
- **Iframe Steel's `debugUrl`.** Steel provides an unauthenticated player endpoint (with `?interactive=true`) — no screencast pipeline or login required.
- **PDF bytes round-trip via base64.** Keeps the server stateless. Costs ~7 MB on the wire per `/api/start`; acceptable for one user.
- **Extension as a second client, not a parallel implementation.** The agent code lives in one place. The extension is a button + a `fetch`.
- **No deep-link auth or token.** Whoever has the `runId` can view the run. Acceptable for the single-user demo; revisit if we publish to the Chrome Web Store.

---

## Failure modes

| Failure | What happens | Mitigation |
|---|---|---|
| Steel session fails to provision | `/api/start` returns `liveUrl: null` after 8 s wait. UI shows "Provisioning…" until SSE delivers an error. | Surface a clearer "Steel slow" state if it takes > 15s. Currently acceptable. |
| ATS blocks Steel IP (403) | `page.goto` throws. Run transitions to `failed`. FailedBanner appears. | Stealth plugin enabled + 2-sec warm-up nav. Escape hatch: switch to Anchor Browser. |
| Anthropic rate-limited | Field mapping or extract throws. Per-field errors are caught and logged; run continues. Extract errors fail the whole run. | Single attempt — no retries. User re-runs. |
| Process restart mid-run | All in-memory state lost. User re-runs. | Documented as acceptable. SaaS phase would persist run state to Postgres. |
| Stagehand hangs in `act()` | Run can take up to ~30 s to react to a Stop click. | Per-step `bail()` is the abort point. True mid-`act()` cancellation isn't supported by Stagehand v3. |
| Extension talks to wrong server | If `apiBase` in storage is stale, `/api/start` 404s and toast fires. | Re-pair to refresh stored config. |

---

For the file map, exact data shapes, and code paths, see [04 — LLD](./04-architecture-lld.md).
