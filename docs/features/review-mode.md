# Feature — Review-Before-Submit, Stop, Submit-for-Real

This doc covers three related user controls that all hang off the same in-memory control-flag mechanism.

## What

- **Review-before-submit toggle** — a switch on the Confirm screen (default **ON**) that tells the runner to pause after filling + uploading the résumé, *before* clicking Submit. The user reviews the filled form in the live iframe and clicks "Submit for real" when satisfied.
- **Submit-for-real button** — appears in the LiveRun header *only* when the run is in `awaiting_review` status. Clicking it `POST /api/submit-now/[runId]`, which flips a flag the runner is polling.
- **Stop button** — appears in the LiveRun header any time the run is active. Clicks `POST /api/stop/[runId]`, which raises a flag the runner checks between steps (next `bail()` call).

## Why

Three independent reasons converge into the same control-flag pattern:

1. **Safety.** Each run sends a real application. A bug in the agent could submit a half-filled form. Review-mode is the kill switch: the agent stops cold before the destructive action.
2. **Trust.** Demos are scarier without an "oh shit" button. Stop lets the user abort if the agent is misbehaving or if they realize the job URL was wrong.
3. **Demo polish.** Watching the agent fill a form is impressive. Watching it *pause and wait for you* feels like collaborating with it, not just kicking off a script.

Implementation choice: **control flags polled by the runner**, not promise cancellation.

- Stagehand v3 doesn't support mid-`act()` cancellation. Even if we held an `AbortController`, the active LLM call can't be interrupted.
- Polling between steps is good enough. The runner has natural checkpoints between every `extract`, `fill`, `upload`, `submit` step.
- Two flags (`stopRequested`, `submitRequested`) are dirt-simple; no Promise gymnastics.

## How

### Files

- [src/lib/agent/events.ts](../../src/lib/agent/events.ts) — control-flag helpers (`requestStop`, `requestSubmit`, `isStopRequested`, `isSubmitRequested`).
- [src/lib/agent/runner.ts](../../src/lib/agent/runner.ts) — `bail()` helper + `waitForSubmitOrStop()` polling loop + reviewMode branch.
- [src/app/api/stop/[runId]/route.ts](../../src/app/api/stop/[runId]/route.ts) — flips the stop flag.
- [src/app/api/submit-now/[runId]/route.ts](../../src/app/api/submit-now/[runId]/route.ts) — flips the submit flag.
- [src/components/confirm.tsx](../../src/components/confirm.tsx) — the Review toggle UI.
- [src/components/live-run.tsx](../../src/components/live-run.tsx) — the Stop + Submit-for-real buttons.

### The control object

Inside the `RunRecord`:

```ts
interface RunRecord {
  meta: RunMetadata;
  emitter: EventEmitter;
  log: AgentEvent[];
  control: {
    stopRequested: boolean;
    submitRequested: boolean;
  };
}
```

Reset to `false` at `createRun`. Mutated by the API routes:

```ts
export function requestStop(runId: string): boolean {
  const record = runs.get(runId);
  if (!record) return false;
  record.control.stopRequested = true;
  return true;
}
export function requestSubmit(runId: string): boolean {
  const record = runs.get(runId);
  if (!record) return false;
  record.control.submitRequested = true;
  return true;
}
```

### The `bail()` helper

Used at every checkpoint in the runner:

```ts
class StoppedError extends Error {
  constructor() { super("Run stopped by user"); this.name = "StoppedError"; }
}

function bail(runId: string) {
  if (isStopRequested(runId)) throw new StoppedError();
}
```

Throwing `StoppedError` jumps to a dedicated `catch` branch that emits `stopped` and finishes the run cleanly:

```ts
try {
  // ... agent steps with bail() calls between each ...
} catch (err) {
  if (err instanceof StoppedError) {
    emit(runId, "stopped", "Run stopped by user");
    finishRun(runId, "stopped");
  } else {
    emit(runId, "error", err.message);
    finishRun(runId, "failed", err.message);
  }
}
```

### Review-mode pause

After all fields + résumé upload are done, **before** the submit click:

```ts
if (reviewMode) {
  updateMeta(runId, { status: "awaiting_review" });
  emit(runId, "awaiting_review", "Form filled — review and click 'Submit for real' in the dashboard to send");

  const submitted = await waitForSubmitOrStop(runId, 5 * 60 * 1000);
  bail(runId);  // throws if stop was requested during the wait
  if (!submitted) {
    emit(runId, "stopped", "No submit action within 5 minutes — stopping");
    finishRun(runId, "stopped");
    return;
  }
}

// ... proceed with submit ...
```

`waitForSubmitOrStop` is a 250ms polling loop:

```ts
async function waitForSubmitOrStop(runId: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isStopRequested(runId)) return false;
    if (isSubmitRequested(runId)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
```

5-minute timeout protects against runs sitting forever (Steel sessions cost $).

### The UI toggle (Confirm screen)

```tsx
<div className="glass rounded-2xl p-4">
  <div className="flex items-center justify-between gap-3">
    <div className="flex items-center gap-2 text-sm text-foreground">
      {reviewMode ? <ShieldCheck className="text-primary" /> : <Zap className="text-amber-400" />}
      <span className="font-medium">
        {reviewMode ? "Review before submit" : "Auto-submit"}
      </span>
    </div>
    <ReviewModeToggle value={reviewMode} onChange={setReviewMode} />
  </div>
  <p className="mt-1.5 text-xs text-muted-foreground">
    {reviewMode
      ? "Agent fills + uploads, then pauses. You click 'Submit for real' on the live screen."
      : "Agent clicks submit on its own once every field is filled."}
  </p>
</div>
```

When auto-submit is on, an amber warning banner appears:

```tsx
{!reviewMode && (
  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-amber-200/90">
    Heads up — auto-submit is on. The agent will click submit without asking.
  </div>
)}
```

### The buttons (LiveRun header)

```tsx
{status === "awaiting_review" && (
  <button onClick={handleSubmitNow} disabled={submitting}>
    {submitting ? <Loader2 className="animate-spin" /> : <Send />}
    Submit for real
  </button>
)}
{!isDone && (
  <button onClick={handleStop} disabled={stopping}>
    {stopping ? <Loader2 className="animate-spin" /> : <Square />}
    Stop
  </button>
)}
```

Handlers:

```ts
async function handleStop() {
  await fetch(`/api/stop/${runId}`, { method: "POST" });
  toast.message("Stopping…", { description: "The agent will halt at the next step." });
}
async function handleSubmitNow() {
  const res = await fetch(`/api/submit-now/${runId}`, { method: "POST" });
  if (!res.ok) throw new Error("Server rejected the submit request");
  toast.message("Submitting…", { description: "Watch the live browser." });
}
```

Both endpoints just flip a flag and return — they don't block on the runner.

### Status flow with review-mode

```text
starting → navigating → filling → awaiting_review → submitting → submitted
                                         │
                                         │  (Stop or 5min timeout)
                                         └→ stopped
```

Without review-mode:

```text
starting → navigating → filling → submitting → submitted
```

`stopped` and `failed` are reachable from any non-terminal state.

## Gotchas

- **Stop latency.** Between steps it's <1s. Mid-`act()` it can be 10–30s because Stagehand can't cancel its LLM call. The toast intentionally says "halt at the next step" — sets expectations.
- **Review timeout = 5 minutes.** If the user opens the tab, gets distracted, and comes back 10 minutes later — the run already auto-stopped. The Steel session was released. They have to re-run. This is a deliberate cost guard.
- **Submit-for-real isn't undoable.** The moment the agent clicks submit, the application is in the ATS. There's no second confirm. Acceptable because the user already had 5 min to review.
- **Default is ON for review-mode.** Even users who *want* auto-submit have to flip the toggle. The amber warning encourages a moment of thought.
- **No partial submit retry.** If the submit click fails (network error, button disabled), the run goes to `failed`. The user can't retry just the submit step — they re-run the whole application. This is fine for the demo; v2 could retry from screenshot.
- **No "I changed my mind, keep filling" path.** Once you click Stop, the run ends. Submit-for-real and Stop are exclusive.

## Verification

### Happy path with review-mode

1. Drop résumé, paste Lever URL.
2. Confirm screen: review-mode toggle is ON by default.
3. Click Start.
4. Watch fields fill in the live iframe. Eventually:
   - Status pill: "Awaiting review" (amber).
   - Phase strip: stopped at "Filling fields" (mapped to filling since awaiting_review is just paused-filling).
   - Footer of the log pane: amber "⏸ paused for review".
   - Header: "Submit for real" button appears.
5. Click Submit for real.
6. Status flips to Submitting → Submitted.
7. Confetti modal appears.

### Stop mid-run

1. Start a run.
2. Once fields are filling, click Stop.
3. Within ~2 seconds, status flips to Stopped, the phase strip turns red.
4. Open `chrome://devtools` Network panel — `POST /api/stop/<id>` returned 200.

### Stop during review

1. Start a run with review-mode ON.
2. When status hits Awaiting review, click Stop instead of Submit for real.
3. Status flips to Stopped. The agent never clicked submit.

### Auto-submit mode

1. Toggle review-mode OFF on Confirm.
2. The amber warning banner appears below the toggle.
3. Click Start. Status flows directly: Filling → Submitting → Submitted. No pause, no Submit-for-real button.

## Failure modes

| Failure | What you see | Mitigation |
|---|---|---|
| Stop hit during long `act()` | 10–30s delay before status flips to Stopped | Toast wording sets expectations; bail at next step |
| Submit-for-real hit but runner crashed | 500 from `/api/submit-now`; run still in awaiting_review | Click Stop to clean up the Steel session manually |
| 5-min review timeout | Run auto-stops; Steel released; user has to re-run | Documented; widen timeout in `waitForSubmitOrStop` if you need more |
| User closes tab during review | Run still alive on server; auto-stops at 5min | Reconnect via deep link `?runId=<id>` to see + control |
| Multiple stop clicks | First wins; subsequent are no-ops | Idempotent flag-flip; toast may double-fire briefly |
