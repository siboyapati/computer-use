# Feature — Agent Runner

## What

The agent runner is the **orchestrator**. Given a parsed `Resume`, a job URL, a model provider, and a review-mode flag, it:

1. Provisions a Steel.dev cloud Chromium session.
2. Connects Stagehand v3 over CDP.
3. Navigates to the job page.
4. Dispatches to the per-ATS adapter to extract the form schema.
5. Fills every field (deterministic → EEO privacy guard → profile extras/saved answers → LLM fallback).
6. Uploads the résumé PDF via Playwright's `setInputFiles`.
7. Optionally pauses for human review.
8. Clicks Submit.
9. Captures the post-submit screenshot.
10. Cleans up.

Every step emits an `AgentEvent` to the in-memory pub/sub, which the UI streams via SSE.

## Why

The agent is the whole product. Everything else (parsing, UI, extension) feeds into it.

Design constraints that shaped the runner:

- **Cost per application < $0.10** — Haiku 4.5 + prompt caching on the field-mapper makes this trivial unless the form is huge.
- **No retries on transient errors** — single-user demo; the user re-runs. Retries hide instability and slow demos.
- **In-process, no queue** — `runApplication` is just an async function called without await from `/api/start`. The Node process runs the agent itself.
- **Per-step `bail()` for cancellation** — Stagehand v3 doesn't support mid-`act()` cancellation. We check the stop flag between steps, which means an active `act()` call can take up to ~30s to react. Acceptable.
- **Always clean up Steel sessions** — sessions are billed per browser-hour. The `finally` block always calls `releaseSession(...)`.

## How

### Files

- [src/lib/agent/runner.ts](../../src/lib/agent/runner.ts) — the orchestration.
- [src/lib/agent/steel.ts](../../src/lib/agent/steel.ts) — Steel SDK wrapper.
- [src/lib/agent/events.ts](../../src/lib/agent/events.ts) — pub/sub, control flags, prune.
- [src/lib/agent/field-mapper.ts](../../src/lib/agent/field-mapper.ts) — see [field-mapping.md](./field-mapping.md).
- [src/lib/agent/adapters/](../../src/lib/agent/adapters/) — see [ats-adapters.md](./ats-adapters.md).
- [src/app/api/start/route.ts](../../src/app/api/start/route.ts) — kicks off the runner.

### Lifecycle

```text
runApplication({ runId, resume, pdfBase64, jobUrl, ats, provider, reviewMode })
  ├─ resolveStagehandModel(provider) → { modelName, apiKey }
  ├─ emit("started", "Starting application...", { provider, modelName, reviewMode })
  ├─ session = await createSession()                ← Steel.dev
  ├─ bail()                                          ← throws StoppedError if stop was requested
  ├─ updateMeta { liveUrl: session.debugUrl + '?interactive=true' }

  ├─ emit("started", "Cloud browser session ready", { liveUrl })
  ├─ stagehand = new Stagehand({ env: "LOCAL", cdpUrl, model })
  ├─ await stagehand.init()
  ├─ bail()
  ├─ updateMeta { status: "navigating" }
  ├─ emit("navigated", "Navigating to ...")
  ├─ page.goto(jobUrl, { waitUntil: "load", timeoutMs: 30_000 })
  ├─ page.waitForSelector("form, [role=form], input[type=email]", 10_000)
  ├─ form = await adapter.extract(stagehand)
  ├─ bail()
  ├─ updateMeta { company, status: "filling" }
  ├─ emit("form_extracted", `Detected ${n} fields at ${company}`, { ... })
  ├─ resumePdfPath = write base64 to os.tmpdir()/autoapply/<runId>/resume.pdf
  ├─ for each fillable field (capped at 40):
  │     bail()
  │     answer = await mapField(field, resume, jobUrl)
  │     if !answer.value: emit("field_filled", "Skipped ...", { skipped: true, reasoning }); continue
  │     await fillSingleField(stagehand, field, answer.value)
  │     emit("field_filled", "Filled ${label}", { label, value: redacted, reasoning })
  ├─ if form.resumeFieldLabel:
  │     ok = await adapter.upload(stagehand, resumePdfPath)
  │     emit("file_uploaded", ...)
  ├─ if reviewMode:
  │     updateMeta { status: "awaiting_review" }
  │     emit("awaiting_review", "Form filled — click Submit for real")
  │     await waitForSubmitOrStop(runId, 5 min)
  │     if not submitted: emit("stopped", "..."); finishRun "stopped"; return
  ├─ updateMeta { status: "submitting" }
  ├─ emit("submitting", "Clicking Submit")
  ├─ await adapter.submit(stagehand)
  ├─ await page.waitForLoadState("networkidle", 15_000).catch(noop)
  ├─ screenshotBuf = await page.screenshot({ fullPage: true })
  ├─ updateMeta { screenshotUrl: dataUrl, status: "submitted" }
  ├─ emit("screenshot", "Captured submission screenshot", { url: dataUrl })
  ├─ emit("submitted", `Submitted to ${company}`)
  └─ finishRun(runId, "submitted")
catch StoppedError:
  ├─ emit("stopped", "Run stopped by user")
  └─ finishRun(runId, "stopped")
catch err:
  ├─ emit("error", err.message)
  └─ finishRun(runId, "failed", err.message)
finally:
  ├─ stagehand.close().catch(noop)
  ├─ releaseSession(session.id)
  └─ rm -rf os.tmpdir()/autoapply/<runId>
```

### Model resolution

```ts
function resolveStagehandModel(provider: LLMProvider): { modelName: string; apiKey: string } {
  if (provider === "google") {
    return {
      modelName: `google/${process.env.GEMINI_MODEL || "gemini-3-flash-preview"}`,
      apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY!,
    };
  }
  return {
    modelName: `anthropic/${process.env.ANTHROPIC_MODEL_DEFAULT || "claude-haiku-4-5"}`,
    apiKey: process.env.ANTHROPIC_API_KEY!,
  };
}
```

The `as never` cast on `modelName` when constructing Stagehand keeps TypeScript quiet — Stagehand's `AvailableModel` is a string union but we're feeding env-var values.

### Fill strategy (`fillSingleField`)

For text-like fields (`text|email|phone|url|textarea`):

1. **`tryFillByLabel`** — XPath chain anchored on the label text:
   - `xpath=//label[normalize-space()=X]/@for/following::*[@id=string(.)][1]` — label `for=` → input
   - `xpath=//label[…]//input | //label[…]//textarea` — input nested in label
   - `xpath=//label[…]/following::input[1]` — input immediately after label
   - `input[aria-label="X" i]`, `textarea[aria-label="X" i]`, `input[placeholder*="X" i]`
2. If none match, fall through to **Stagehand `act()`**: `act("Fill the '<label>' field with: <value>")`.

For `select` fields:

1. **`trySelectByLabel`** — XPath anchored, then `locator.selectOption(value)`.
2. Fallback to `act()`.

For `file` fields: never use the LLM. Adapter-specific selector chain → `locator.setInputFiles(path)`.

The XPath approach is the result of an audit ([04 — LLD §E](../04-architecture-lld.md#e--field-mapping-algorithm)) — Playwright doesn't support `>>` `..` "go to parent" pseudo-selectors, which was the original (broken) implementation.

### `xpathLiteral` helper

The label text can contain quotes. We build a safe XPath literal:

```ts
function xpathLiteral(s: string): string {
  if (!s.includes("'")) return `'${s}'`;
  if (!s.includes('"')) return `"${s}"`;
  // Build a concat() that escapes both quote types
  const parts = s.split("'").map((p) => `'${p}'`);
  return `concat(${parts.join(",\"'\",")})`;
}
```

Without this, labels like `"That's a great job"` would break the XPath.

### Redaction in event logs

Filled values are passed through `redact()` before they hit the SSE stream:

```ts
function redact(value: string): string {
  if (value.length <= 4) return value;
  if (value.includes("@")) {
    const [user, domain] = value.split("@");
    return `${user.slice(0, 2)}***@${first(domain)}***${tld}`;
  }
  if (/^https?:/i.test(value)) return `${new URL(value).hostname}/…`;
  if (value.length > 60) return value.slice(0, 60) + "…";
  return value;
}
```

Reasoning: the live event log is visible on screen and in screenshots people might share. Email and URLs are PII; long answers are noise.

### Run lifecycle

[events.ts](../../src/lib/agent/events.ts):

- `createRun(meta)` — registers a `RunRecord { meta, emitter, log, control }` keyed by `runId`. Schedules the prune timer on first call.
- `emit(runId, kind, message, data?)` — appends to `log[]`, emits `"event"` on the emitter. The SSE handler subscribes to this emitter.
- `updateMeta(runId, patch)` — merges patch into `meta` (used for status transitions + liveUrl + screenshot).
- `finishRun(runId, finalStatus, error?)` — sets `meta.status`, `meta.finishedAt`, emits `"done"`. SSE handler closes the stream on `"done"`.
- `requestStop(runId)` / `requestSubmit(runId)` — flip `control.stopRequested` / `control.submitRequested`.
- `isStopRequested(runId)` / `isSubmitRequested(runId)` — polled by the runner.
- `pruneOldRuns(olderThanMs = 30 min)` — drops finished runs older than the threshold from the map. Scheduled on a 5-min interval, timer is `unref()`-ed.

The `RunRecord` map grows unbounded if no one calls prune. We call it via the auto-scheduled interval. For a single-user demo this is fine.

## Gotchas

- **Stop is best-effort.** Between steps it's fast. Inside a single `stagehand.act()` it can take 10–30 s. There's no API to cancel mid-`act()` in Stagehand v3.
- **The 5-minute review-mode timeout** auto-stops the run if the user doesn't click Submit (or Stop). This keeps Steel sessions from running forever.
- **`page.goto` with `waitUntil: "load"` may fire before SPA hydration** on Ashby. The `waitForSelector` after it is the guard — but if the form is fully client-rendered with no `<form>` tag and no `[role=form]`, extraction sees a skeleton and returns 0 fields. The cap-at-40 logic also covers this corner.
- **`screenshot({ fullPage: true })` can be 1–3 MB encoded.** It rides along in the META event and the screenshot modal. For one user, fine. At scale we'd write to object storage and serve a URL.
- **Workday is hard-blocked** at `detectATS` (returns `null`). If a Workday URL slips through, `/api/start` rejects with a clear 400.
- **`MAX_FIELDS_TO_FILL = 40`.** Pathological forms (50+ fields) get capped — we emit an "error" event explaining the cap, then proceed with the first 40 fields. Prevents cost runaway.
- **Stagehand init is not idempotent.** If the Steel session disconnects mid-init, the runner errors and the run goes to `failed`. No retry.
- **Pino logger is disabled** (`disablePino: true`). For deep debugging temporarily set `verbose: 2` to surface Stagehand internals.

## Verification

Run [features/live-stream.md#verification](./live-stream.md#verification) — the live stream test exercises this entire feature.

For a runner-isolated test:

```bash
npm run spike -- "https://jobs.lever.co/<company>/<job-id>"
```

Watch the Steel live-view URL (printed in console). The agent should:
1. Open the Lever page in the cloud browser.
2. Read all visible form fields (you'll see the page rendered).
3. Fill name + email + phone fields from a sample résumé.
4. Stop before submit (the spike script does NOT submit).

Cost: ~$0.05 per spike, ~60s wallclock.

## Failure modes

| Failure | What you see | Mitigation |
|---|---|---|
| Steel session never starts | UI: "Provisioning cloud browser..." forever; SSE never gets meta with liveUrl | Steel API key wrong or quota exhausted; check Steel dashboard |
| `page.goto` 403 (ATS blocks Steel IP) | Run goes to `failed` with "net::ERR_*" message | Enable Steel stealth plugin; warm-up nav; escape hatch = Anchor Browser |
| Extract returns 0 fields | `form_extracted` event with `fieldCount: 0`; nothing fills; submit clicks an empty form | Wait for hydration is in place; if still 0, the page may not have a real form (e.g., "this job is closed" page) |
| Field-mapper Claude call fails | Single field error logged, run continues | No retry; user re-runs if too many fields skipped |
| `act("submit")` clicks the wrong button | A different button gets clicked | Per-adapter we try `button[type="submit"]` first; act() is fallback only |
| Run hangs in `act()` | Status stuck on "Filling" for >2 min | Click Stop; the bail will fire on the next iteration |
| Stagehand fails to close | Steel session lingers ~10 min before its own timeout | Best-effort `stagehand.close()` in finally; `releaseSession()` always called |
