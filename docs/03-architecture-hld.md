# 03 — Architecture (High-Level Design)

## One-paragraph summary

A single Next.js process on Railway hosts a three-state web UI and three API endpoints. The UI walks the user through Landing → Confirm → Live Run. The Live Run page subscribes via Server-Sent Events to an in-memory pub/sub keyed by `runId`. A background async task in the same Node process drives a Stagehand session against a cloud Chromium provided by Steel.dev; that session's `liveUrl` is embedded in the page via `<iframe>`. Claude Haiku 4.5 (or Gemini 3 Flash) supplies the reasoning. No queue, no database, no Redis.

## System diagram

```text
                       ┌────────────────────────────────┐
                       │           Browser (you)         │
                       └────────────────┬────────────────┘
                                        │
                                        ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │                  Next.js process on Railway                       │
   │                                                                   │
   │   src/app/page.tsx ─ 3-state UI                                  │
   │     • Landing      → POST /api/parse-resume                      │
   │     • Confirm      → POST /api/start                             │
   │     • LiveRun      → GET  /api/events/:runId (SSE)               │
   │                                                                   │
   │   src/app/api/                                                    │
   │     • parse-resume/route.ts                                       │
   │         └─ Anthropic PDF input → strict JSON via tool_use        │
   │     • start/route.ts                                              │
   │         └─ Creates runId + in-memory record                       │
   │            Fires runApplication() async, returns liveUrl          │
   │     • events/[runId]/route.ts                                     │
   │         └─ Pipes EventEmitter into text/event-stream              │
   │                                                                   │
   │   src/lib/agent/                                                  │
   │     • events.ts ─ Map<runId, EventEmitter> + log replay           │
   │     • runner.ts ─ Stagehand orchestration                         │
   │     • adapters/{lever,greenhouse,ashby}.ts ─ per-ATS specifics    │
   │     • field-mapper.ts ─ deterministic + LLM fallback              │
   │                                                                   │
   └───────────────────────────────┬─────────────────────────────────-─┘
                                   │
                                   │ (CDP WebSocket)
                                   ▼
                ┌──────────────────────────────────────┐
                │   Steel.dev cloud Chromium session    │
                │   • websocketUrl    → Stagehand CDP   │
                │   • sessionViewerUrl → <iframe>       │
                └──────────────────────────────────────┘
                                   │
                                   ▼
                ┌──────────────────────────────────────┐
                │   ATS application page                │
                │   (Lever / Greenhouse / Ashby)        │
                └──────────────────────────────────────┘

   ┌──────────────────┐        ┌──────────────────────┐
   │  Anthropic API   │◀──────▶│  Google Gemini API    │
   │  • PDF input     │        │  • Stagehand option   │
   │  • Haiku 4.5     │        │  • via @ai-sdk/google │
   └──────────────────┘        └──────────────────────┘
```

## The three core components

### 1. Résumé Parser

**Input:** PDF (≤5 MB) uploaded as `multipart/form-data` to `POST /api/parse-resume`.

**Process:**
1. Read bytes from the form.
2. Forward to Anthropic Messages API with the PDF as a `document` content block.
3. Force `tool_use` with a single `save_resume` tool whose `input_schema` is the [Résumé Zod schema](../src/lib/agent/types.ts).
4. Validate the returned JSON with `ResumeSchema.parse(toolUse.input)`.

**Output:** `{ resume: Resume, pdfBase64: string }`. The PDF base64 round-trips back to the client so the agent can re-upload it later without storing files server-side.

### 2. Agent Runner

**Trigger:** `POST /api/start` with `{ resume, pdfBase64, jobUrl, provider }`.

**Process:**
1. Detect ATS from URL hostname → reject if unsupported.
2. Generate `runId`, register an in-memory `EventEmitter` keyed by it.
3. Fire `runApplication(...)` without `await` (long-running, ~30–120s).
4. Wait up to 8s for the Steel `liveUrl` to populate so it's in the start response (otherwise the UI has to wait a tick).
5. Return `{ runId, liveUrl, ats }`.

Inside `runApplication`:
1. Create a Steel.dev session (`websocketUrl`, `sessionViewerUrl`).
2. Initialize Stagehand with `env: "LOCAL"` and `localBrowserLaunchOptions.cdpUrl = websocketUrl`. Model = `anthropic/claude-haiku-4-5` or `google/gemini-3-flash-preview`.
3. Navigate to the job URL.
4. Call the ATS adapter's `extract()` to get `{ company, fields[], resumeFieldLabel }`.
5. For each non-file field: map to a value via `mapField()` (deterministic dictionary, then EEO heuristics, then LLM fallback). Fill via `tryFillByLabel()` (label-anchored selector chain) or Stagehand `act()`.
6. Upload the résumé PDF via Playwright's `setInputFiles()` (LLM not involved).
7. Click submit via Stagehand `act()`.
8. Wait for network idle, capture full-page screenshot.
9. Emit `submitted` + `completed` events.

### 3. Live UI

**Layout:** single `page.tsx` with a `useReducer` state machine. Three phases:
- `landing` → Landing component (drop zone + hero)
- `confirm` → Confirm component (parsed résumé card + URL input + model toggle)
- `live` → LiveRun component (split-screen: Steel iframe + event log + phase strip + celebration)

**Event flow:**
- On entering `live`, page opens `new EventSource('/api/events/:runId')`.
- Server-side SSE handler replays the run's log (so reconnects don't miss events), subscribes to the `EventEmitter`, and pipes new events as `event: agent\ndata: {...}\n\n`. A separate `event: meta` line carries run metadata.
- Client dispatches `EVENT` and `META` actions into the reducer; `LiveRun` re-renders.

## Why this shape

- **One Node process, no queue:** for a single-user demo, in-memory pub/sub is fast and trivial. Adding Redis or a worker would buy us nothing here.
- **SSE over WebSocket:** SSE auto-reconnects, works through proxies, and Next.js has no special handling needed — just a `ReadableStream` in the route handler.
- **Iframe the Steel `sessionViewerUrl`:** Steel exposes a publicly viewable session URL designed to be embedded. No screencast pipeline to build.
- **PDF bytes round-trip via base64:** keeps the server stateless. If we wanted history or restart, we'd need Supabase Storage; for the demo we don't.

## Failure modes to know

| Failure | What happens |
|---|---|
| Steel session fails to start | Run never gets `liveUrl`. `/api/start` returns `liveUrl: null` after 8s. UI shows "Provisioning..." until the run errors. |
| ATS blocks Steel IP (403) | Stagehand `goto()` errors. Run emits `error`, transitions to `failed`, UI shows banner. |
| Form schema extract returns empty | Adapter still proceeds with `fillable = []`; nothing fills, agent submits an empty form. Mitigation: add a "min 3 fields detected" sanity check (TODO). |
| Anthropic / Gemini rate-limited | Run emits `error` and dies. No retry logic. Demo user re-clicks Start. |
| Process restart mid-run | Run state lost (in-memory). User re-runs. Documented as acceptable. |

See [04 — LLD](./04-architecture-lld.md) for the actual code paths and data shapes.
