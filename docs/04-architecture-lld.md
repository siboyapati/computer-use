# 04 — Architecture (Low-Level Design)

The HLD ([03 — Architecture HLD](./03-architecture-hld.md)) is the map. This is the terrain: every file you'll touch, every data shape, every API contract, and the algorithms that matter.

For feature-by-feature deep dives, see [`features/`](./features/). For exact API request/response shapes, see [reference/api.md](./reference/api.md).

---

## Repository layout

```text
computer-use/
├── docs/                                  # this folder
├── extension/                             # Chrome extension (Plasmo, separate package)
│   ├── package.json
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── tsconfig.json
│   ├── assets/icon.png                    # 512x512, rasterized by Plasmo
│   └── src/
│       ├── background.ts                  # service worker
│       ├── popup.tsx                      # toolbar popup (Tailwind)
│       ├── options.tsx                    # options page (Tailwind)
│       ├── styles.css                     # Tailwind directives + Fraunces import
│       ├── contents/
│       │   └── overlay.ts                 # floating button content script (vanilla, shadow DOM)
│       └── lib/
│           ├── types.ts                   # Resume + StoredConfig + message types
│           ├── detect.ts                  # ATS hostname detection (mirror of web app)
│           ├── storage.ts                 # chrome.storage.local wrapper
│           └── api.ts                     # /api/start client, URL builders
├── spike.ts                               # W0 standalone validation script
├── .env.local.example                     # required env vars
├── next.config.ts
├── package.json
└── src/
    ├── app/
    │   ├── layout.tsx                     # dark mode + Fraunces/Inter/JetBrains Mono
    │   ├── globals.css                    # warm dark palette, oklch, .glass + .font-display
    │   ├── page.tsx                       # 3-state reducer + SSE wiring + deep-link
    │   ├── connect/
    │   │   └── page.tsx                   # extension pairing handshake page
    │   └── api/
    │       ├── parse-resume/route.ts      # POST: PDF → Resume JSON
    │       ├── start/route.ts             # POST: kicks off run, returns { runId, liveUrl, ats }
    │       ├── events/[runId]/route.ts    # GET: SSE stream
    │       ├── runs/[runId]/route.ts      # GET: meta (for deep-link hydrate)
    │       ├── stop/[runId]/route.ts      # POST: flip stop flag
    │       └── submit-now/[runId]/route.ts# POST: flip submit-now flag (review mode)
    ├── components/
    │   ├── landing.tsx                    # state 1: drop zone + stored-résumé CTA + history strip
    │   ├── confirm.tsx                    # state 2: parsed-résumé card + URL + model + review toggle
    │   ├── live-run.tsx                   # state 3: split iframe + event stream + Stop/Submit-for-real
    │   ├── event-log.tsx                  # streaming terminal-style log with per-kind icons
    │   ├── resume-card.tsx                # glassy parsed-résumé card (reused in landing + confirm)
    │   ├── run-history.tsx                # horizontal strip of recent runs with thumbnails
    │   └── ui/                            # shadcn primitives
    └── lib/
        ├── client-types.ts                # AppState + reducer types (client-safe)
        ├── storage.ts                     # localStorage helpers (résumé + history)
        ├── cors.ts                        # corsHeaders / preflightResponse / withCors
        ├── utils.ts                       # cn() (shadcn)
        └── agent/
            ├── types.ts                   # Resume schema, ATS, LLMProvider, AgentEvent, RunMetadata
            ├── events.ts                  # Map<runId,...> + emit/finish/prune/stop/submit
            ├── steel.ts                   # Steel SDK wrapper (createSession, release)
            ├── resume-parser.ts           # Anthropic PDF input + tool_use
            ├── field-mapper.ts            # deterministic + EEO + LLM-fallback mapping
            ├── runner.ts                  # Stagehand orchestration + ATS dispatch
            └── adapters/
                ├── lever.ts               # Lever extract / upload / submit
                ├── greenhouse.ts          # Greenhouse extract / upload / submit
                └── ashby.ts               # Ashby extract / upload / submit
```

---

## Key data shapes

### `Resume` (canonical answer source)

Defined as a Zod schema in [src/lib/agent/types.ts](../src/lib/agent/types.ts). Strict shape:

```ts
{
  personal: { fullName, firstName, lastName, email, phone, location, linkedin, github, website },
  headline: string,
  summary: string,
  experience:     Array<{ company, title, startDate, endDate, location, description }>,
  education:      Array<{ school, degree, field, startDate, endDate }>,
  skills:         string[],
  projects:       Array<{ name, description, url }>,
  certifications: string[],
}
```

All string fields default to `""`, all arrays default to `[]`. Zod validates the Anthropic `tool_use` output server-side AND the API response on the client. The extension mirrors this type in [extension/src/lib/types.ts](../extension/src/lib/types.ts) — kept in sync manually (~50 lines, not worth a workspace).

### `AgentEvent` (SSE payload)

```ts
{
  id: uuid,
  runId: uuid,
  kind: "started" | "navigated" | "form_extracted" | "field_filled"
      | "file_uploaded" | "awaiting_review" | "submitting"
      | "submitted" | "screenshot" | "stopped" | "error" | "completed",
  ts: number,                  // Date.now()
  message: string,             // user-facing one-liner
  data?: Record<string, unknown>,
}
```

### `RunMetadata`

```ts
{
  runId, jobUrl, ats: "lever" | "greenhouse" | "ashby",
  liveUrl: string | null,                      // Steel sessionViewerUrl
  status: "starting" | "navigating" | "filling"
        | "awaiting_review" | "submitting"
        | "submitted" | "failed" | "stopped",
  company: string | null,                      // populated after form_extracted
  startedAt: number,
  finishedAt: number | null,
  screenshotUrl: string | null,                // data:image/png;base64,…
  error: string | null,
}
```

### Extension `StoredConfig`

In [extension/src/lib/types.ts](../extension/src/lib/types.ts). Persisted to `chrome.storage.local` under key `autoapply.config.v1`:

```ts
type StoredConfig =
  | { paired: false }
  | {
      paired: true,
      apiBase: string,                         // e.g. "http://localhost:3000"
      resume: Resume,
      pdfBase64: string,                       // up to ~7 MB
      fileName: string,
      pairedAt: number,
    };
```

---

## Code paths

### A — User drops PDF on web app

```text
Landing.handleFile(file)
  → POST /api/parse-resume (multipart/form-data)
      → parse-resume/route.ts
        → parseResumeFromPdf(buf)                  // src/lib/agent/resume-parser.ts
            → anthropic.messages.create({
                model: claude-haiku-4-5,
                tools: [save_resume],
                tool_choice: { type: "tool", name: "save_resume" },
              })
            → ResumeSchema.parse(toolUse.input)
        → returns { resume, pdfBase64 }
  → dispatch({ type: "PARSED", resume, pdfBase64, fileName })
  → saveResume(...) writes to localStorage          // src/lib/storage.ts
  → phase = "confirm"
```

Time: ~3–7 seconds for a typical résumé.

### B — User clicks Start

```text
Confirm.onStart(jobUrl, provider, reviewMode)
  → POST /api/start { resume, pdfBase64, jobUrl, provider, reviewMode }
      → start/route.ts
        → StartSchema.safeParse(body)               // strict shape check
        → detectATS(jobUrl) → "lever" | "greenhouse" | "ashby" | null
        → if google && no GOOGLE_GENERATIVE_AI_API_KEY → 400
        → runId = randomUUID()
        → createRun({ runId, jobUrl, ats })         // src/lib/agent/events.ts
        → void runApplication({ ... })              // fire-and-forget
        → waitForLiveUrl(runId, 8000)               // polls .meta.liveUrl
        → return { runId, liveUrl, ats }
  → dispatch({ type: "STARTED", runId, liveUrl, ats })
  → phase = "live"
```

### C — Live Run reads events

```text
useEffect on state.runId:
  → new EventSource("/api/events/" + runId)
      → events/[runId]/route.ts
        → getRun(runId)
        → for event in run.log: send("agent", event)    // replay any events emitted before subscribe
        → send("meta", run.meta)
        → run.emitter.on("event", e => send("agent", e) + send("meta", latest))
        → run.emitter.on("done", () => send("meta", final) + send("done") + close)
  → "agent" msg → dispatch({ type: "EVENT", event })
  → "meta" msg  → dispatch({ type: "META", meta })
  → "done"      → EventSource.close()
```

### D — `runApplication` server-side

[src/lib/agent/runner.ts](../src/lib/agent/runner.ts):

```text
runApplication({ runId, resume, pdfBase64, jobUrl, ats, provider, reviewMode })
  ├─ resolveStagehandModel(provider) → { modelName, apiKey }
  ├─ emit "started"  (with provider/modelName/reviewMode in data)
  ├─ session = await createSession()                    // src/lib/agent/steel.ts
  ├─ bail(runId)                                         // throws StoppedError if stop was requested
  ├─ updateMeta(runId, { liveUrl: session.sessionViewerUrl })
  ├─ emit "started" with liveUrl
  ├─ stagehand = new Stagehand({ env: "LOCAL", cdpUrl: session.websocketUrl, model })
  ├─ await stagehand.init()
  ├─ bail
  ├─ emit "navigated" → page.goto(jobUrl, { waitUntil: "load", timeoutMs: 30_000 })
  ├─ page.waitForSelector("form, [role=form], input[type=email], input[type=file]", 10_000)
  ├─ form = await adapter.extract(stagehand)            // adapters/<ats>.ts
  ├─ updateMeta { company, status: "filling" }
  ├─ emit "form_extracted" with fields[]
  ├─ resumePdfPath = write base64 to tmp file
  ├─ for each fillable field (capped at MAX_FIELDS_TO_FILL = 40):
  │     bail
  │     answer = await mapField(field, resume, jobUrl)  // field-mapper.ts
  │     if !answer.value → emit "field_filled" skipped; continue
  │     await fillSingleField(stagehand, field, value)
  │     emit "field_filled" with redacted value
  ├─ if form.resumeFieldLabel:
  │     ok = await adapter.upload(stagehand, resumePdfPath)
  │     emit "file_uploaded" { ok }
  ├─ if reviewMode:
  │     updateMeta { status: "awaiting_review" }; emit "awaiting_review"
  │     await waitForSubmitOrStop(runId, 5 * 60_000)
  │     if stop or timeout → emit "stopped" + finishRun "stopped"; return
  ├─ updateMeta { status: "submitting" }; emit "submitting"
  ├─ await adapter.submit(stagehand)
  ├─ page.waitForLoadState("networkidle", 15_000).catch(noop)
  ├─ screenshot = await page.screenshot({ fullPage: true })
  ├─ updateMeta { screenshotUrl: data-url, status: "submitted" }
  ├─ emit "screenshot" + "submitted"
  └─ finishRun(runId, "submitted")
catch StoppedError:
  ├─ emit "stopped", finishRun "stopped"
catch err:
  ├─ emit "error", finishRun "failed"
finally:
  ├─ stagehand.close()
  ├─ releaseSession(session.id)
  └─ rm -rf tmpdir/autoapply/<runId>
```

### E — Field mapping algorithm

In [src/lib/agent/field-mapper.ts](../src/lib/agent/field-mapper.ts):

```text
mapField(field, resume, jobUrl) {
  1. Deterministic dictionary — DETERMINISTIC array of { regex, key }:
       /^(full\s*)?name$/i  → r.personal.fullName
       /first\s*name/i      → r.personal.firstName
       /last\s*name/i       → r.personal.lastName
       /^e?-?mail/i         → r.personal.email
       /phone|mobile|cell/i → r.personal.phone
       /linked\s*in/i       → r.personal.linkedin
       /github/i            → r.personal.github
       /portfolio|website/i → r.personal.website
       /^(city|location|address)/i  → r.personal.location
       /current\s*(company|employer)/i → r.experience[0]?.company
       /current\s*(title|role|position)/i → r.experience[0]?.title
       /^school|university|college/i → r.education[0]?.school
       /^degree/i           → r.education[0]?.degree
       /^headline|tagline/i → r.headline

  2. EEO heuristic — if field.label matches
       /race|ethnic|gender|disab|veteran|hispanic|latino|sex\b|pronoun|orientation|identify/i
     pick first option matching
       /decline|prefer not|do not wish|don.?t wish|rather not|not.*say|wish.*disclose/i
     fall back to the LAST option if no decline-style match (avoids submitting blank required field).

  3. LLM fallback — single Anthropic call:
       - system: cacheable résumé block (cache_control: ephemeral)
       - user: "Form field label: <label>\nField type: <type>\nOptions: <list>\n\nReturn ONLY the value."
}
```

The resume block ships once per run thanks to `cache_control: ephemeral` — 20 custom questions on the same form pay the résumé token cost once.

### F — Fill strategy per field type

`fillSingleField()` in [runner.ts](../src/lib/agent/runner.ts):

1. For `text|email|phone|url|textarea`: `tryFillByLabel()` first — XPath chain anchored to `<label normalize-space()="X">`:
   - `//label[normalize-space()=X]/@for/following::*[@id=string(.)][1]` (label `for` → input)
   - `//label[normalize-space()=X]//input | //label[…]//textarea` (input nested in label)
   - `//label[…]/following::input[1]` (input immediately after label)
   - `input[aria-label*="X" i]`, `textarea[aria-label*="X" i]`, `input[placeholder*="X" i]`
2. For `select`: `trySelectByLabel()` — XPath anchored, then `locator.selectOption(value)`.
3. Fallback for everything: `stagehand.act("Fill the '<label>' field with: <value>")`.

For file types we never use the LLM — adapter-specific `setInputFiles` chain (see [features/ats-adapters.md](./features/ats-adapters.md)).

---

## ATS adapters

Each adapter ([lever.ts](../src/lib/agent/adapters/lever.ts), [greenhouse.ts](../src/lib/agent/adapters/greenhouse.ts), [ashby.ts](../src/lib/agent/adapters/ashby.ts)) implements three functions:

```ts
extract(stagehand): Promise<ExtractedForm>     // ATS-tuned prompt for stagehand.extract
upload(stagehand, pdfPath): Promise<boolean>   // CSS selector chain → setInputFiles
submit(stagehand): Promise<void>               // deterministic CSS/XPath → click; act() fallback
```

The differences captured in the extraction prompt:

- **Lever**: "Include text inputs, textareas, dropdowns, radio groups, checkboxes, file uploads. Skip section headers and links."
- **Greenhouse**: explicit mention of `intl-tel-input` phone fields + `react-select` dropdowns.
- **Ashby**: "Target by labels and ARIA roles, not class names — class-hashed SPA."

If you add a new ATS, the adapter is ~50 lines. Wire it up in `ADAPTERS` in [runner.ts](../src/lib/agent/runner.ts) and add the host to `detectATS` in [types.ts](../src/lib/agent/types.ts).

---

## API surface

Full request/response shapes are in [reference/api.md](./reference/api.md). Quick overview:

| Method | Path | What |
|---|---|---|
| POST | `/api/parse-resume` | PDF → `Resume` JSON |
| POST | `/api/start` | Kicks off a run, returns `{ runId, liveUrl, ats }` |
| GET | `/api/events/[runId]` | SSE stream of agent events |
| GET | `/api/runs/[runId]` | One-shot read of `RunMetadata` (used by deep-link hydration) |
| POST | `/api/stop/[runId]` | Sets `control.stopRequested = true` |
| POST | `/api/submit-now/[runId]` | Sets `control.submitRequested = true` |

Every route has an `OPTIONS` handler that returns CORS preflight headers via [src/lib/cors.ts](../src/lib/cors.ts) so the Chrome extension can call them.

---

## Concurrency, lifetimes, cleanup

- **One Stagehand session per `runId`.** No pooling.
- **In-memory pub/sub.** [events.ts](../src/lib/agent/events.ts) maintains `Map<runId, { meta, emitter, log, control }>`. `pruneOldRuns()` runs on a 5-minute interval (timer is `unref()`-ed so it doesn't block process exit).
- **Tempdir cleanup.** Résumé PDF lives at `os.tmpdir()/autoapply/<runId>/resume.pdf`. The `finally` block in `runApplication` does `rm -rf` on the per-run directory.
- **SSE handler.** Removes its EventEmitter listeners on `done`. If the client disconnects without `done`, the listeners stay attached until the next event triggers them — then the `controller.enqueue` throws and we close.
- **Stagehand close.** Best-effort. If it fails, the Steel session still gets released independently.

---

## Web app changes for the extension

These exist purely to make the extension work:

- **[src/lib/cors.ts](../src/lib/cors.ts)** — permissive CORS helper, applied to every public API route.
- **[src/app/api/runs/[runId]/route.ts](../src/app/api/runs/[runId]/route.ts)** — GET endpoint so a fresh tab (opened by the extension) can hydrate its UI without subscribing to SSE first.
- **[src/app/connect/page.tsx](../src/app/connect/page.tsx)** — pairing handshake page; reads `?ext_id=`, calls `chrome.runtime.sendMessage`.
- **`useEffect` in [src/app/page.tsx](../src/app/page.tsx)** — reads `?runId=` query param on mount, hydrates `RunMetadata`, dispatches `STARTED`, strips the param from the URL.

See [features/chrome-extension.md](./features/chrome-extension.md#web-app-integration) for the full pairing + handoff diagram.

---

## What's deliberately not implemented

- **Retries on Anthropic/Gemini errors** — single attempt; user re-runs.
- **Per-IP rate limiting / cost cap** — single user. Per-run field cap (40) is the only guard.
- **Server-side run persistence** — all state in-memory. SaaS phase = Supabase Postgres.
- **Auth** — anyone with `runId` can read the SSE. Acceptable for single-user demo.
- **Multi-step / paginated form support** — Workday-style. Hard-blocked by `detectATS`.
- **True mid-`act()` cancellation** — `bail()` only fires at step boundaries; a single long `act()` call can take ~30 s to halt.
