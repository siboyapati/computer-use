# Feature — Live Browser Stream

## What

A split-screen view that lets the user **watch the agent work in real time**:

- **Left (60%)** — the actual cloud Chromium browser rendered in an `<iframe>` via Steel.dev's `sessionViewerUrl`.
- **Right (40%)** — a streaming terminal-style event log driven by Server-Sent Events from the in-memory pub/sub.
- **Top** — a phase strip (Booting → Reading → Filling → Submitting → Done) that lights up as the run progresses.
- **Bottom** — a thinking indicator or paused-for-review notice depending on state.
- **Header** — Stop button (always available while running) + Submit-for-real button (appears in review mode).

When the agent finishes, a celebration modal animates in with the post-submit screenshot.

## Why

This is the demo's hero moment. The product becomes obvious as soon as someone watches it. Without the live stream, AutoApply would feel like every other form-fill tool — a button that may or may not work. With it, the user trusts the agent because they can see exactly what it's doing.

Design moves chosen on purpose:

- **Iframe the cloud browser** instead of WebSocket-streaming pixels. Steel publishes `sessionViewerUrl` already configured for embedding — zero infra to build.
- **Server-Sent Events** instead of WebSockets. SSE auto-reconnects, works through proxies, and Next.js handles it with a `ReadableStream` — no custom WS server.
- **Phase strip + event log** rather than a single status spinner. The user needs *narrative*. A spinner says "working"; the event log says "✓ Filled email, ▸ Reading custom question..."
- **Confetti on submit.** Demos that end on a moment of celebration get shared more.

## How

### Files

- [src/components/live-run.tsx](../../src/components/live-run.tsx) — the split layout, phase strip, header buttons, celebration modal, failure banner.
- [src/components/event-log.tsx](../../src/components/event-log.tsx) — the streaming terminal log with per-kind icons + colors.
- [src/app/api/events/[runId]/route.ts](../../src/app/api/events/[runId]/route.ts) — the SSE handler.
- [src/lib/agent/events.ts](../../src/lib/agent/events.ts) — the in-memory pub/sub.
- [src/app/page.tsx](../../src/app/page.tsx) — wires `useReducer` actions to incoming SSE events.

### The data flow

```text
Runner emits AgentEvent
  └→ events.ts: append to log[], record.emitter.emit("event", e)
       └→ SSE handler (subscribed to that emitter)
            ├→ controller.enqueue("event: agent\ndata: {...}\n\n")
            └→ controller.enqueue("event: meta\ndata: {...}\n\n")
                 └→ EventSource in page.tsx
                      ├→ "agent" → dispatch({ type: "EVENT", event })
                      ├→ "meta"  → dispatch({ type: "META", meta })
                      └→ LiveRun + EventLog re-render
```

### SSE replay on connect

A subtle but important detail: when the client first connects to `/api/events/<runId>`, the run may have already emitted 3–5 events during the 8-second `waitForLiveUrl` window in `/api/start`. If we only pipe new events, the client misses them and the event log looks like the run started mid-stride.

So the SSE handler **replays the run's `log[]` first**, then subscribes for new events:

```ts
for (const event of run.log) send("agent", event);   // replay
send("meta", run.meta);                              // initial meta

run.emitter.on("event", (event) => {
  send("agent", event);
  send("meta", getRun(runId).meta);                  // include latest meta
});
run.emitter.on("done", () => {
  send("meta", getRun(runId).meta);
  send("done", { ok: true });
  controller.close();
});

if (run.meta.finishedAt) {
  // Run already done before we connected — emit done after replay
  onDone();
}
```

The client deduplicates by event `id`:

```ts
case "EVENT": {
  if (state.events.some((e) => e.id === action.event.id)) return state;
  return { ...state, events: [...state.events, action.event] };
}
```

So replay is safe even if the SSE auto-reconnects mid-run.

### The phase strip

[live-run.tsx](../../src/components/live-run.tsx) `PhaseStrip`:

```ts
const PHASES: Array<{ key: RunStatus; label: string }> = [
  { key: "starting",   label: "Booting browser" },
  { key: "navigating", label: "Reading the form" },
  { key: "filling",    label: "Filling fields" },
  { key: "submitting", label: "Submitting" },
  { key: "submitted",  label: "Done" },
];
```

- `awaiting_review` is mapped to the `filling` stage so the strip doesn't jump backwards.
- On `failed` or `stopped`, all phases light up in destructive color (red) so the user sees a clear terminal state.

### Status pill

The header shows a colored pill:

| Status | Pill text | Color |
|---|---|---|
| starting/navigating | "Starting"/"Reading" | neutral, spinner |
| filling | "Filling" | neutral, spinner |
| awaiting_review | "Awaiting review" | amber, no spinner |
| submitting | "Submitting" | neutral, spinner |
| submitted | "Submitted" | primary (green) |
| failed | "Failed" | destructive (red) |
| stopped | "Stopped" | muted |

### The iframe

```tsx
<iframe
  src={liveUrl}
  className="absolute inset-0 h-full w-full"
  sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
  title="Live browser session"
/>
```

`allow-forms` is required — without it Steel's viewer UI (which contains form elements for controls) breaks. `allow-popups` lets Steel open auth flows in popups if a posting requires login (rare).

While the agent is actively filling/submitting, a **pulsing border** wraps the iframe:

```tsx
{acting && (
  <div className="pointer-events-none absolute inset-0 rounded-3xl ring-1 ring-primary/30 [box-shadow:0_0_60px_rgba(212,255,80,0.18)_inset] animate-pulse" />
)}
```

This is a small visual touch that makes the agent feel "alive."

### The event log

[event-log.tsx](../../src/components/event-log.tsx) maps each `AgentEvent.kind` to an icon and color:

```ts
const STYLES: Record<AgentEventKind, { icon, label, color }> = {
  started:         { icon: <Sparkles/>,         label: "init",   color: "text-primary" },
  navigated:       { icon: <Globe2/>,           label: "nav",    color: "text-sky-300" },
  form_extracted:  { icon: <Search/>,           label: "read",   color: "text-violet-300" },
  field_filled:    { icon: <Check/>,            label: "fill",   color: "text-emerald-300" },
  file_uploaded:   { icon: <Upload/>,           label: "upload", color: "text-emerald-300" },
  awaiting_review: { icon: <Pause/>,            label: "pause",  color: "text-amber-300" },
  submitting:      { icon: <MousePointerClick/>, label: "submit", color: "text-primary" },
  submitted:       { icon: <Check/>,            label: "done",   color: "text-primary" },
  screenshot:      { icon: <Eye/>,              label: "shot",   color: "text-muted-foreground" },
  stopped:         { icon: <Square/>,           label: "stop",   color: "text-muted-foreground" },
  error:           { icon: <AlertTriangle/>,    label: "err",    color: "text-destructive" },
  completed:       { icon: <Check/>,            label: "done",   color: "text-primary" },
};
```

Each entry animates in with a spring transition. The log auto-scrolls on every new event. Below the log, an animated `▍ thinking` indicator runs while the agent is mid-step.

### Celebration modal

On `submitted`, a 400ms delay then a modal animates in:

- Big "Submitted to {company}." headline (Fraunces serif).
- The post-submit screenshot.
- Two CTAs: "Keep looking" (close) and "Apply to another" (dispatches `APPLY_ANOTHER`, which keeps the résumé and jumps back to Confirm).

A CSS-only confetti animation runs across the top of the modal — 24 colored dots fall with staggered animation delays. Zero JS, zero deps.

### Failure banner

If the run ends in `failed`, a fixed-position banner appears at the bottom:

```tsx
<motion.div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-2xl border border-destructive/40 bg-destructive/15 px-5 py-3 text-sm text-destructive shadow-2xl backdrop-blur">
  <div className="font-medium">Run failed</div>
  <div className="text-destructive/85">{message}</div>
  <button onClick={onRestart}>Try again</button>
</motion.div>
```

## Gotchas

- **iframe X-Frame-Options.** Steel publishes `sessionViewerUrl` configured for embedding. If Steel ever ships an update that breaks this, fallback is a popup window (`window.open`).
- **SSE doesn't reconnect on a closed `controller`.** The handler removes its listeners on `done`. If the client disconnects without `done` (network blip, tab closed), the listeners stay attached until the next event fires and the `enqueue` throws. Not a leak in practice but worth knowing.
- **Auto-scroll bug:** if the user manually scrolls up to read older events, the next event auto-scrolls them back to the bottom. v2 could detect manual scroll and pause auto-scroll until the user returns to the bottom. Not implemented.
- **Screenshot is base64, up to ~3 MB.** It rides along in the META event payload. For one user this is fine; at scale we'd upload to S3 and serve a URL.
- **`done` event closes the EventSource.** Once closed, the client can't replay. If you want to re-open the run later, hit `GET /api/runs/[runId]` to fetch meta + screenshot; the run record stays in-memory for 30 min after finish.
- **Phase strip is best-effort.** If the runner emits events out of strict order (e.g., an `error` mid-filling), the strip may show "Reading the form" while the status pill shows "Failed". The status pill is the source of truth.

## Verification

1. Start a real run via the web app.
2. Watch the iframe — you should see the cloud Chromium navigating + typing.
3. Watch the event log — events should appear in real time, animating in with a spring.
4. Phase strip should advance: Booting → Reading → Filling.
5. When `awaiting_review` fires, an amber footer appears in the log pane: "paused for review — click Submit for real above."
6. Click Submit for real (header button) — status flips to Submitting, then Submitted.
7. Confetti modal appears with screenshot.
8. Click "Apply to another" — you're back on the Confirm screen with your résumé still loaded, URL cleared.

If the iframe is blank: open `liveUrl` directly in another tab to confirm Steel is up. If events don't appear: check the Network panel for the SSE connection (look for `events/<runId>` with `Content-Type: text/event-stream`).

## Failure modes

| Failure | What you see | Mitigation |
|---|---|---|
| Steel viewer URL not iframable | Blank iframe, log still updates | Fall back to opening `liveUrl` in a new tab (manual workaround); revisit Steel config |
| SSE connection drops | Events stop arriving, browser auto-reconnects | EventSource handles reconnect; dedup-by-id keeps state consistent |
| Run finished before client connected | Replay happens then `done` fires; UI hydrates correctly | Already handled |
| Browser blocks third-party iframe | iframe blank | Browser security setting; user must allow third-party content for the Steel domain |
| Screenshot too large | Slow modal render | Capped at JPEG-quality default; consider downsampling for very large pages (not implemented) |
