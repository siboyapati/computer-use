# Feature — Persistence + Sample Résumé

## What

Two client-side persistence layers on top of `localStorage`, plus a built-in sample résumé for zero-setup demos:

1. **Stored résumé** — the parsed JSON + the PDF base64 + the original filename. Survives full page refresh. Surfaces on the landing page as a "Use last résumé (Alex, alex.pdf)" CTA.
2. **Run history** — the last 5 finished runs (`submitted` or `failed`). Each entry has `company`, `jobUrl`, `status`, `ats`, `screenshotUrl`, and `finishedAt`. Renders as a horizontal strip of thumbnail cards on the landing page.
3. **Sample résumé** — a synthetic Alex Chen résumé bundled as `public/sample-resume.pdf` + a matching pre-parsed `Resume` JSON. The "Try with sample résumé" button on Landing loads both instantly, skipping the Anthropic parse call.

**Server-side persistence is intentionally none.** All run state lives in-memory in the Node process. Refresh the server, lose every active run.

## Why

### Why persist on the client at all?

Without persistence, a refresh forces the user to re-upload their PDF and re-parse it. That's a 5-second tax on every visit. For a demo and especially for repeat use, it's unacceptable friction.

With persistence:

- Returning users skip the parse step entirely.
- The Confirm screen loads instantly from cache.
- "Use last résumé" feels like the right default; the explicit drop-zone is still there for swapping.

### Why client-side, not server-side?

This is a demo, not a SaaS. A server-side database means:

- Auth (so we know whose résumé is whose).
- Encryption (PII at rest).
- A schema migration story.

All of that adds days of work for a demo. `localStorage` is per-browser, per-origin — exactly the right scope for "remember this for me" without auth.

When this becomes a SaaS, the upgrade path is: keep `localStorage` for guest mode, add Supabase Storage + Postgres for logged-in users.

### Why a run history?

Watching a run is fun. Looking back at "what did I apply to last week" is the retention loop. A strip of recent runs with screenshot thumbnails on the landing page is the cheapest possible version of an application history dashboard.

It also serves a "trust" function during a demo: the screenshot proves the submission was real.

## How

### Files

- [src/lib/storage.ts](../../src/lib/storage.ts) — all the localStorage logic.
- [src/components/run-history.tsx](../../src/components/run-history.tsx) — the horizontal strip UI.
- [src/components/landing.tsx](../../src/components/landing.tsx) — renders the "Use last résumé" CTA + the history strip.
- [src/app/page.tsx](../../src/app/page.tsx) — hydrates from storage on mount, writes on each parse/finish.

### Storage keys

```ts
const KEY_RESUME  = "autoapply.resume.v1";
const KEY_HISTORY = "autoapply.history.v1";
```

Versioned namespace (`v1`) so a future schema break doesn't crash on old data — we'd just ignore it and re-parse.

### Stored résumé shape

```ts
interface StoredResume {
  resume: Resume;       // parsed JSON
  pdfBase64: string;    // up to ~7 MB
  fileName: string;     // original filename for display
  storedAt: number;     // Date.now() at save time
}
```

Stored under `autoapply.resume.v1` as JSON.

### Size guard

```ts
const MAX_PDF_BYTES = 6 * 1024 * 1024;  // ~6 MB base64 ≈ 4.5 MB raw

if (data.pdfBase64.length > MAX_PDF_BYTES) {
  return;  // silently skip persistence; session still works
}
```

Why silently skip? localStorage quota is 5–10 MB depending on the browser. A 6 MB+ base64 PDF would throw `QuotaExceededError`. Rather than surfacing the error, we just don't persist — the user re-uploads on next visit. They can always shrink their PDF.

### History shape

```ts
interface HistoryItem {
  runId: string;
  company: string | null;
  jobUrl: string;
  status: "submitted" | "failed" | "stopped";
  ats: "lever" | "greenhouse" | "ashby";
  screenshotUrl: string | null;     // data:image/png;base64,...
  finishedAt: number;
}
```

Stored as an array under `autoapply.history.v1`, capped at 5 items (newest first).

### Recording a run

```ts
export function recordRun(meta: RunMetadata, ats: HistoryItem["ats"]): void {
  if (meta.status !== "submitted" && meta.status !== "failed") return;  // skip "stopped" by intent
  const current = loadHistory();
  const next: HistoryItem = {
    runId: meta.runId,
    company: meta.company,
    jobUrl: meta.jobUrl,
    status: meta.status === "submitted" ? "submitted" : "failed",
    ats,
    screenshotUrl: meta.screenshotUrl,
    finishedAt: meta.finishedAt ?? Date.now(),
  };
  const filtered = current.filter((h) => h.runId !== next.runId);  // dedupe
  const merged = [next, ...filtered].slice(0, MAX_HISTORY);
  window.localStorage.setItem(KEY_HISTORY, JSON.stringify(merged));
}
```

Triggered from `page.tsx` via a `useEffect` watching `state.meta`:

```ts
useEffect(() => {
  if (!state.meta || !state.ats) return;
  if (state.meta.status !== "submitted" && state.meta.status !== "failed") return;
  recordRun(state.meta, state.ats);
  setHistory(loadHistory());
}, [state.meta, state.ats]);
```

### Why dedupe by `runId`?

If the user finishes a run, then re-opens the same run via `?runId=<id>` deep link, the run record would otherwise be inserted twice. Dedupe keeps the strip clean.

### Why not include "stopped" in history?

A stopped run didn't produce a submission. Showing it as a "recent application" would be misleading. We do include `failed` runs because the user might want to retry from history (currently they have to manually re-paste the URL).

### The run history strip UI

[run-history.tsx](../../src/components/run-history.tsx):

- Horizontal scroll container, 5 cards max.
- Each card: ~180px wide, screenshot top, company + ATS + "5m ago" below.
- Status badge in the top-right of each card: ✓ for submitted, ✗ for failed.
- Card is an `<a target="_blank">` pointing at the original `jobUrl`.

Relative time formatting via a small helper:

```ts
function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
```

### Hydrate-on-mount

[page.tsx](../../src/app/page.tsx):

```tsx
const [storedResume, setStoredResume] = useState<StoredResume | null>(null);
const [history, setHistory] = useState<HistoryItem[]>([]);

// Hydrate from localStorage on first mount (client-only)
useEffect(() => {
  setStoredResume(loadResume());
  setHistory(loadHistory());
}, []);
```

These are state, not refs, so the Landing component re-renders when storage changes (e.g., after a new run finishes).

### Stored-résumé CTA on Landing

[landing.tsx](../../src/components/landing.tsx):

```tsx
{storedResume && !busy && (
  <div className="mt-3 flex items-center justify-center gap-2 text-xs text-muted-foreground">
    <button onClick={onUseStoredResume}>
      <RotateCcw /> Use last résumé ({storedResume.resume.personal.firstName}, {storedResume.fileName})
    </button>
    <button onClick={onForgetStoredResume} aria-label="Forget stored résumé">
      <X />
    </button>
  </div>
)}
```

`onUseStoredResume` dispatches `USE_STORED` which jumps to the Confirm screen without re-parsing. `onForgetStoredResume` calls `clearResume()` and clears the state.

### "Apply to another" preserves the résumé

In the reducer:

```ts
case "APPLY_ANOTHER":
  if (state.resume && state.pdfBase64) {
    return {
      ...INITIAL_STATE,
      phase: "confirm",
      resume: state.resume,
      pdfBase64: state.pdfBase64,
      fileName: state.fileName,
      provider: state.provider,
    };
  }
  return INITIAL_STATE;
```

The celebration modal's "Apply to another" button dispatches this — keeps the résumé loaded, jumps back to Confirm so the user can paste a new URL.

`BACK_TO_LANDING` (the back arrow on Confirm) similarly keeps the résumé:

```ts
case "BACK_TO_LANDING":
  return { ...INITIAL_STATE, resume, pdfBase64, fileName };
```

Both these actions are different from `RESET`, which clears everything.

## Gotchas

- **localStorage is per-origin.** A run from `localhost:3000` is invisible to `127.0.0.1:3000`. Stick to one origin during dev.
- **Quota varies by browser** (5 MB Safari, 10 MB Chrome/Firefox). Our 6 MB cap aims at the middle.
- **Screenshots are base64 in history.** Each ~1–3 MB. Five history entries × 2 MB ≈ 10 MB, which can hit Safari's quota. If we hit issues, switch to IndexedDB (effectively unlimited) — adds a small library like Dexie.
- **No server-side de-dupe.** If you start the same `runId` deep-link in two tabs, you'd get two `recordRun` calls. The localStorage logic dedupes by `runId`.
- **"Stopped" runs not in history by design.** Users might want this. Easy v2 toggle.
- **History isn't synced across devices.** Per-browser only. SaaS phase = Supabase.
- **localStorage writes are synchronous on the main thread.** A 7 MB write blocks for a few ms. Imperceptible at this scale.
- **PII implications.** The PDF base64 and parsed JSON sit in localStorage forever until the user clicks "Forget" or clears site data. We should add a privacy note in the README before publishing the extension.

## Verification

### Persistence

1. Drop a résumé. Confirm screen appears.
2. Hard-refresh the page.
3. Landing screen: a "Use last résumé (Alex, resume.pdf)" button appears below the drop zone.
4. Click it → Confirm screen loads instantly, no parsing.
5. Click the small ✗ next to the button → "Forgot stored résumé" toast; button disappears; reload confirms persistence is gone.

### History strip

1. Run a real application end-to-end. Wait for the confetti modal.
2. Click "Apply to another" — Confirm screen loads with résumé preserved.
3. Click the back arrow to return to Landing.
4. Below the drop zone, the **Recent applications** strip shows your run with the post-submit screenshot, company name, and "just now".
5. Click the card → opens the original job URL in a new tab.
6. Run 4 more applications. The 6th submission pushes the oldest out of the strip (cap = 5).

### Inspect storage

In dev tools:

```js
localStorage.getItem("autoapply.resume.v1")    // → JSON string
localStorage.getItem("autoapply.history.v1")   // → array of 1-5 entries
```

## Sample résumé {#sample-résumé}

A second persistence path with zero localStorage involved: the "Try with sample résumé" button on Landing.

### Why the sample button exists

For demos + first-time visitors who don't want to upload a real résumé just to see the agent work. One click, no API call, no Anthropic cost — they go straight to the Confirm screen with a realistic synthetic candidate (Alex Chen, Senior Software Engineer).

### How it loads

- **PDF** lives at [public/sample-resume.pdf](../../public/sample-resume.pdf) — 1.5 KB hand-rolled valid PDF.
- **Pre-parsed JSON** lives at [src/lib/sample-data.ts](../../src/lib/sample-data.ts) as `SAMPLE_RESUME`.
- The PDF was generated by [scripts/gen-sample-pdf.mjs](../../scripts/gen-sample-pdf.mjs) — a small Node script with no dependencies that writes raw PDF bytes with computed xref offsets. Re-run it after editing the script if you want to change the sample content.
- The button calls `loadSamplePdfBase64()` which fetches `/sample-resume.pdf`, converts to base64, and dispatches `USE_STORED` with the hardcoded `SAMPLE_RESUME`.

### Why pre-parse instead of running the real parser

Two reasons:

1. **Cost** — every sample click would otherwise be an Anthropic PDF input call (~$0.001 + 3s latency). At demo scale this adds up.
2. **Determinism** — the parsed JSON shape is known and tested. We never have to worry about the parser misreading the synthetic PDF (which is small and hand-built, so the parser might extract weirdly).

The trade-off: edits to `SAMPLE_RESUME` JSON and the PDF text need to be kept in sync manually. The script tries to make this easy — the constants in `scripts/gen-sample-pdf.mjs` and `src/lib/sample-data.ts` should match. If they drift, the parsed view on Confirm will show the JSON while the agent uploads a PDF with different content.

### Regenerating the sample PDF

```bash
node scripts/gen-sample-pdf.mjs
# ✓ Wrote public/sample-resume.pdf (1553 bytes)
```

No dependencies needed — the script writes raw PDF bytes with hand-computed offsets.

## Failure modes

| Failure | What you see | Mitigation |
|---|---|---|
| PDF > 6 MB | Silent skip on `saveResume`; reload loses the résumé | Shrink the PDF; possibly surface a soft warning |
| `QuotaExceededError` on history save | Silent skip on `recordRun` | Eviction kicks in next time; or move history to IndexedDB |
| Stale entry in history (URL 404s) | Card opens to "page not found" | User clicks 'Forget' or it auto-evicts after 5 newer entries |
| Cross-origin localStorage isolation | "Use last résumé" missing on prod after dev | Document; switch domains rare in practice |
| Sample PDF 404 | "Couldn't load sample résumé" toast | Re-run `node scripts/gen-sample-pdf.mjs` to regenerate `public/sample-resume.pdf` |
