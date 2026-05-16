# 04 — Architecture (Low-Level Design)

## File map

```text
computer-use/
├── docs/                                  # this folder
├── spike.ts                               # W0 standalone validation script
├── .env.local.example                     # required env vars
├── next.config.ts
├── package.json
└── src/
    ├── app/
    │   ├── layout.tsx                     # dark mode + Fraunces/Inter/JetBrains Mono
    │   ├── globals.css                    # warm dark palette, oklch, .glass + .font-display
    │   ├── page.tsx                       # 3-state reducer + SSE wiring
    │   └── api/
    │       ├── parse-resume/route.ts      # POST: PDF → Resume JSON
    │       ├── start/route.ts             # POST: kicks off run
    │       └── events/[runId]/route.ts    # GET: SSE stream
    ├── components/
    │   ├── landing.tsx                    # state 1: drop zone
    │   ├── confirm.tsx                    # state 2: card + URL + model toggle
    │   ├── live-run.tsx                   # state 3: split UI + celebration
    │   ├── event-log.tsx                  # terminal-style streaming log
    │   ├── resume-card.tsx                # glassy parsed-résumé card
    │   └── ui/                            # shadcn primitives
    └── lib/
        ├── client-types.ts                # AppState + reducer types (client-safe)
        ├── utils.ts                       # cn() (shadcn)
        └── agent/
            ├── types.ts                   # Resume schema, ATS, LLMProvider, AgentEvent
            ├── events.ts                  # Map<runId, EventEmitter> + emit/finish/prune
            ├── steel.ts                   # Steel SDK wrapper (createSession, release)
            ├── resume-parser.ts           # Anthropic PDF input + tool_use
            ├── field-mapper.ts            # deterministic + EEO + LLM-fallback mapping
            ├── runner.ts                  # Stagehand orchestration
            └── adapters/
                ├── lever.ts               # Lever extract / upload / submit
                ├── greenhouse.ts          # Greenhouse extract / upload / submit
                └── ashby.ts               # Ashby extract / upload / submit
```

## Key data shapes

### `Resume` (canonical answer source)

Defined in [src/lib/agent/types.ts](../src/lib/agent/types.ts) as a Zod schema. Shape:

```ts
{
  personal: { fullName, firstName, lastName, email, phone, location, linkedin, github, website },
  headline: string,
  summary: string,
  experience: Array<{ company, title, startDate, endDate, location, description }>,
  education:  Array<{ school, degree, field, startDate, endDate }>,
  skills:     string[],
  projects:   Array<{ name, description, url }>,
  certifications: string[],
}
```

All string fields default to `""`, all arrays default to `[]`. Zod validates this server-side after Anthropic returns the `tool_use` block and client-side after the API response.

### `AgentEvent` (SSE payload)

```ts
{
  id: uuid,
  runId: uuid,
  kind: "started" | "navigated" | "form_extracted" | "field_filled"
      | "file_uploaded" | "submitting" | "submitted" | "screenshot"
      | "error" | "completed",
  ts: number,           // Date.now()
  message: string,      // user-facing one-liner
  data?: Record<string, unknown>,
}
```

### `RunMetadata`

```ts
{
  runId, jobUrl, ats,
  liveUrl: string | null,              // Steel session viewer URL
  status: "starting" | "navigating" | "filling" | "submitting" | "submitted" | "failed",
  company: string | null,              // populated after form_extracted
  startedAt, finishedAt: number | null,
  screenshotUrl: string | null,        // data:image/png;base64 after submit
  error: string | null,
}
```

## Code paths (request flow)

### A — User drops PDF

```
Landing.handleFile(file)
  → POST /api/parse-resume (multipart)
      → parse-resume/route.ts
        → parseResumeFromPdf(buf)
            → anthropic.messages.create({ model, tools: [save_resume], tool_choice: {tool} })
            → ResumeSchema.parse(toolUse.input)
        → returns { resume, pdfBase64 }
  → dispatch({ type: "PARSED", resume, pdfBase64, fileName })
  → phase = "confirm"
```

Time: ~3–7 seconds (Anthropic PDF input).

### B — User clicks Start

```
Confirm.onStart(jobUrl, provider)
  → POST /api/start { resume, pdfBase64, jobUrl, provider }
      → start/route.ts
        → StartSchema.safeParse(body)
        → detectATS(jobUrl) → "lever" | "greenhouse" | "ashby" | null
        → runId = randomUUID()
        → createRun({ runId, jobUrl, ats })            // events.ts → Map
        → void runApplication({ ... })                 // fire-and-forget
        → poll getRun(runId).meta.liveUrl every 100ms (max 8s)
        → return { runId, liveUrl, ats }
  → dispatch({ type: "STARTED", runId, liveUrl, ats })
  → phase = "live"
```

### C — Live Run reads events

```
useEffect on state.runId:
  → new EventSource("/api/events/" + runId)
      → events/[runId]/route.ts:
        → getRun(runId)
        → for each event in run.log: send("agent", event)       // replay
        → send("meta", run.meta)
        → run.emitter.on("event", e => send("agent", e))
        → run.emitter.on("done", () => send("done") + close)
  → on each "agent" msg: dispatch({ type: "EVENT", event })
  → on each "meta" msg:  dispatch({ type: "META", meta })
  → on "done": EventSource.close()
```

### D — runApplication (server-side, async)

```
runApplication({ runId, resume, pdfBase64, jobUrl, ats, provider })
  ├─ resolveStagehandModel(provider) → { modelName, apiKey }
  ├─ emit "started"
  ├─ session = await createSession()                      // steel.ts
  ├─ updateMeta(runId, { liveUrl: session.sessionViewerUrl })
  ├─ emit "started" with liveUrl
  ├─ stagehand = new Stagehand({ env: "LOCAL", cdpUrl: session.websocketUrl, model })
  ├─ await stagehand.init()
  ├─ emit "navigated" → page.goto(jobUrl) → emit "navigated" (loaded)
  ├─ form = await adapter.extract(stagehand)             // adapters/{ats}.ts
  ├─ updateMeta { company, status: "filling" }
  ├─ emit "form_extracted" with fields[]
  ├─ resumePdfPath = write base64 to OS temp file
  ├─ for each fillable field:
  │     answer = await mapField(field, resume, jobUrl)   // field-mapper.ts
  │     await fillSingleField(stagehand, field, value)
  │     emit "field_filled"
  ├─ adapter.upload(stagehand, resumePdfPath)            // setInputFiles bypass
  ├─ emit "file_uploaded"
  ├─ updateMeta { status: "submitting" }; emit "submitting"
  ├─ adapter.submit(stagehand)
  ├─ await page.waitForLoadState("networkidle", 15s).catch(noop)
  ├─ screenshotBuf = await page.screenshot({ fullPage: true })
  ├─ updateMeta { screenshotUrl: "data:image/png;base64,…", status: "submitted" }
  ├─ emit "screenshot" + "submitted"
  └─ finishRun(runId, "submitted")
catch err:
  ├─ emit "error", finishRun "failed"
finally:
  ├─ stagehand.close()
  └─ releaseSession(session.id)
```

## Field-mapping algorithm

In `src/lib/agent/field-mapper.ts`:

```text
mapField(field, resume, jobUrl) {
  // 1. Deterministic dictionary (cheap, ~zero tokens)
  for each (regex, key) in DETERMINISTIC:
    if regex.test(field.label) and key(resume) is non-empty:
      return { value: key(resume), reasoning: "matched resume directly" }

  // 2. EEO / demographic — prefer "Decline to answer"
  if /race|ethnic|gender|disab|veteran|hispanic|latino|pronoun/i.test(field.label):
    decline = field.options?.find(/decline|prefer not|do not wish/i)
    return { value: decline ?? "", reasoning: "EEO question — declined by default" }

  // 3. LLM fallback (single Claude call, system prompt includes the resume JSON)
  return answerCustomQuestion(field, resume, jobUrl)
}
```

Deterministic regexes cover: full/first/last name, email, phone, LinkedIn, GitHub, portfolio, location, current company/title, school, degree, headline.

## Fill strategy per field type

`fillSingleField()` in `runner.ts`:

1. For `text/email/phone/url/textarea` types: try `tryFillByLabel()` first — walks a candidate selector chain (`label:has-text() >> .. >> input`, `[aria-label*=]`, `[placeholder*=]`). If any selector resolves to a visible element, `locator.fill(value)`.
2. If deterministic fill fails: fall back to Stagehand `act("Fill the X field with: Y")` which uses the accessibility tree.

For `file` types we never use the LLM — call `page.locator("input[type=file]").setInputFiles(path)` directly, with per-ATS selector preferences in `adapters/{ats}.ts`.

## ATS adapters (the only ATS-specific code)

Each adapter implements three functions:

```ts
extract(stagehand): Promise<ExtractedForm>     // calls stagehand.extract with an ATS-tuned prompt
upload(stagehand, pdfPath): Promise<boolean>   // try a chain of selectors for file input
submit(stagehand): Promise<void>               // stagehand.act with ATS-tuned button name
```

Differences captured in the extraction prompt:
- **Lever:** "Skip section headers and links. Include text inputs, textareas, dropdowns, radio groups, checkboxes, file uploads."
- **Greenhouse:** explicit mention of `intl-tel-input` and `react-select` for custom questions; demographic dropdowns.
- **Ashby:** "Target by labels and ARIA roles, not class names — class-hashed SPA."

If a new ATS needed adding, the adapter is ~50 lines.

## Concurrency, lifetimes, and cleanup

- **One Stagehand session per runId.** No pooling.
- **In-memory pub/sub:** `events.ts` keeps a `Map<runId, { meta, emitter, log }>`. `pruneOldRuns()` is defined but not called yet — the demo's expected volume doesn't need it.
- **Tempdir cleanup:** résumé PDF is written to `os.tmpdir()/autoapply/{runId}/resume.pdf`. Not cleaned up after the run; relies on OS temp cleanup. (Acceptable for demo.)
- **SSE:** `events/[runId]/route.ts` removes its listeners on `done`. If the client disconnects without `done`, the listeners stay attached until the next event triggers them (then the `controller.enqueue` throws and we close). Not a leak in practice.

## What's deliberately not implemented

- **Retries on Anthropic / Gemini errors** — single attempt; the user re-runs.
- **Rate limiting / cost cap** — single user (you). See plan.
- **Storage** — Postgres / Supabase. PDFs round-trip via base64; nothing persists.
- **Auth** — none. Anyone with the URL can start a run. Acceptable for hosted demo (single user).
- **Pagination of multi-step forms** — Lever, Greenhouse, Ashby are single-page. Adding Workday would require a multi-step loop.
