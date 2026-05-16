# Feature — User Profile & Learning

## What

A persistent **UserProfile** stored client-side that extends the parsed résumé with two things:

1. **`extras`** — structured ATS-common fields that don't fit the standard résumé schema. Work authorization, salary range, earliest start date, willingness to relocate, notice period, etc. The user fills these once on the Settings page.
2. **`learnedAnswers`** — a dictionary of question → answer pairs, keyed by a **normalized question hash**. Populated either explicitly on the Settings page or automatically when the user types into a previously-skipped field during review mode.

The field-mapper consults both **before** falling back to the LLM call, so a question the user has answered before fills instantly with zero tokens.

## Why

Today's runner gets stuck on the same kinds of questions every time:

- "Are you authorized to work in the US?"
- "What's your salary expectation?"
- "When is your earliest start date?"

None of these live on a standard résumé. The agent leaves them empty, marks them as `skippedRequired`, and waits for the user to type the answer manually. Without a memory layer, the user types the same answer on every single application. That's the friction this feature removes.

Three benefits of getting this right:

1. **User saves time** — answer once, fills automatically forever after.
2. **Cost** — zero LLM tokens for repeat questions. A form with 5 custom questions, all previously answered, costs *zero* on the LLM side.
3. **Quality** — the user's own words go into the form, not Claude's interpretation. Higher trust, no hallucination risk.

## How

### Files

**Server-safe types (used by both client and runner):**
- [src/lib/agent/profile-types.ts](../../src/lib/agent/profile-types.ts) — `UserProfile`, `ProfileExtras`, `LearnedAnswer`, plus the `normalizeQuestion()` / `matchExtra()` / `extraToString()` helpers.

**Client storage (browser-only):**
- [src/lib/profile.ts](../../src/lib/profile.ts) — `loadProfile()`, `saveProfile()`, `patchExtras()`, `recordAnswer()`, `forgetAnswer()`, `previewProfileAnswer()`. Persists to `localStorage` under `autoapply.profile.v1`.

**Field-mapper integration:**
- [src/lib/agent/field-mapper.ts](../../src/lib/agent/field-mapper.ts) — `profileAnswer()` checks learnedAnswers (exact key match) → extras (heuristic match) → returns answer if found. Called between Tier 1 (résumé) and Tier 2 (EEO) in `mapField()`.

**Inline learn during review:**
- [src/lib/agent/events.ts](../../src/lib/agent/events.ts) — `requestFill(runId, label, value)` + `drainFillRequests(runId)` for queuing inline fills.
- [src/app/api/fill/[runId]/route.ts](../../src/app/api/fill/[runId]/route.ts) — POST endpoint the UI calls to queue a fill.
- [src/lib/agent/runner.ts](../../src/lib/agent/runner.ts) — `waitForSubmitOrStop()` drains the queue every 250ms and executes each fill via `stagehand.act()`.

**UI surfaces:**
- [src/app/settings/page.tsx](../../src/app/settings/page.tsx) — Profile section with editable Extras + Learned Answers list.
- [src/components/live-run.tsx](../../src/components/live-run.tsx) — `SkippedRequiredFooter` with one editable row per skipped field. Click "Save & fill" → `recordAnswer()` locally AND POST `/api/fill/[runId]`.

### Five-tier field mapping

```text
1.   Deterministic dictionary   — name, email, phone, LinkedIn (résumé.personal.*)
1.5. Profile extras             — work auth, salary, start date (heuristic label match)  ← NEW
1.6. Learned answers            — exact normalized-question match                         ← NEW
2.   EEO heuristic              — decline by default
3.   LLM fallback               — Claude generates from résumé
```

Each tier is cheaper than the last. Tiers 1.5 and 1.6 are zero-LLM lookups.

### Normalization

```ts
function normalizeQuestion(label: string): string {
  return label
    .toLowerCase()
    .replace(/\s*\*\s*$/, "")           // trailing required asterisk
    .replace(/\s*\(required\)\s*$/i, "")
    .replace(/[?:.!,;"'`]/g, "")        // punctuation
    .replace(/\s+/g, " ")               // collapse whitespace
    .trim();
}
```

This makes the following all hash to the same key, hitting the same saved answer:

- `"Why are you interested in this role?"`
- `"Why are you interested in this role"`
- `"WHY ARE YOU INTERESTED IN THIS ROLE *"`
- `"why are you interested in this role (required)"`

### Heuristic `matchExtra`

For structured fields, regex matches the incoming label to a key on `ProfileExtras`:

```ts
matchExtra("Are you authorized to work in the US?")  // → "workAuthorization"
matchExtra("Salary expectations")                     // → "salaryMin"
matchExtra("Earliest start date")                     // → "earliestStartDate"
matchExtra("Are you willing to relocate?")            // → "willingToRelocate"
matchExtra("How did you hear about us?")              // → "howDidYouHear"
```

When `salaryMin` matches but the user has also filled `salaryMax`, the formatter returns `"USD 180,000–240,000"`. Booleans become `"Yes"`/`"No"`.

### Data flow — first time a field is skipped

```text
1. Agent extracts form, sees "Why are you interested in this role?" (required).
2. mapField runs Tier 1 (résumé silent), Tier 1.5 (no match), Tier 1.6
   (no saved answer), Tier 2 (not EEO), Tier 3 (LLM returns "").
3. value is empty + field.required = true → pushed into skippedRequired[].
4. Agent finishes everything else, hits awaiting_review.
5. UI footer shows the editable row with the label + input.
6. User types "Your platform shipped the agent SDK I've been studying..."
7. Clicks Save & fill:
   a. recordAnswer("Why are you interested in this role?", "Your platform...")
      → localStorage updated; key = "why are you interested in this role".
   b. POST /api/fill/<runId> { label, value }
      → requestFill() queues it on runs.get(runId).control.fillRequests.
      → waitForSubmitOrStop drains within 250ms, calls
        stagehand.act("Fill the 'Why are you interested in this role?' field with: <value>")
      → field gets filled in the live cloud browser
      → emit "field_filled" with reasoning "user-provided during review"
   c. Toast confirms; row hides itself.
8. User clicks Submit for real.
```

### Data flow — same question on a future application

```text
1. Agent extracts form, sees "Why do you want to work here?" — DIFFERENT label.
   Misses the learnedAnswers key (different normalization).
   Tier 3 LLM fires.
   
   OR if the label is identical/similar enough to hash the same:
2. Tier 1 (résumé silent), Tier 1.5 (no match), Tier 1.6 HITS:
   key = "why are you interested in this role"
   → learnedAnswers[key].answer
   → returns instantly with reasoning "saved answer (used 3x before)"
3. Field fills, timesUsed counter increments next save, no LLM call.
```

The Settings page's Learned Answers list shows the entry with "Used 3× · last 5m ago".

### Settings UI

`/settings` → Profile section, three parts:

1. **Profile extras** — a 2-column grid of typed inputs (text/number/select/boolean) for each `ProfileExtras` field. Saves on blur via `patchExtras()`.
2. **Learned answers** — a list of saved Q→A entries, each with a "Forget" button. Sorted by `lastUsedAt` descending.
3. **Security note** — explains that all data lives in localStorage and never leaves your browser except inside `/api/start` request bodies.

### LiveRun footer UI

When `status === "awaiting_review"`:

- **Empty `skippedRequired`**: just the amber "paused for review" hint.
- **Non-empty**: each label gets its own editable row with an inline input and "Save & fill" button. After save, the row fades out (state-local `hidden` map keyed by label).

## Gotchas

- **Variants don't auto-merge.** "Why are you interested?" and "Why do you want this job?" hash to different keys. The user re-saves once for the new wording; it's then permanent. Semantic matching via embeddings is a future feature.
- **Field-mapper sees the profile as static.** If a run is mid-flight and you update the profile from the Settings page, the running agent doesn't pick it up. New profile state takes effect on the next `/api/start` call.
- **Salary heuristic is rough.** `matchExtra` returns `salaryMin` for any salary-shaped label; the formatter joins min+max if both are set, else returns just min. ATSes that ask for max separately won't get both filled — we only have one slot in the form. Acceptable in practice; users can override with `recordAnswer` for specific labels.
- **`recordAnswer` increments `timesUsed`; `saveAnswer` doesn't.** The "Save & fill" button uses `recordAnswer` (it represents an actual use). The Settings page's pre-population helper uses `saveAnswer` to avoid inflating the counter.
- **No cross-device sync.** Per-browser only. SaaS phase = move to Supabase.
- **Empty answers don't get persisted.** `recordAnswer("...", "")` is a no-op. The user can clear an entry via the Settings "Forget" button.
- **Extras with `undefined` get dropped.** `patchExtras({ salaryMin: undefined })` removes that key from the stored extras object. Setting an input to empty clears the value.
- **The `fillRequests` queue is per-runId in-memory.** Process restart → queue gone → user re-clicks Save (but the answer is already in localStorage at that point so it'll still apply to future runs).

## Verification

### Pre-populate via Settings

1. Visit `/settings`.
2. Profile extras section: set "Work authorization" = "Yes, US citizen", "Salary minimum" = 180000, "Salary maximum" = 240000, "Currency" = "USD".
3. Run a real application on a Lever job that asks for these.
4. Watch the event log — those fields fill with `reasoning: "profile: workAuthorization"` and `reasoning: "profile: salary range"` (or similar). Zero LLM calls for them.

### Auto-learn via review

1. Run an application where a required custom question is in the form (e.g. "What interests you about this role?").
2. Agent leaves it empty → status flips to Awaiting review → footer shows the question as an editable row.
3. Type your answer, click **Save & fill**.
4. Toast confirms; the answer appears in the live cloud browser within ~1s.
5. Visit `/settings` → the Learned Answers section shows your new entry with "Used 1× · just now".
6. Run another application on a job that asks the same question (any wording that normalizes the same way).
7. The answer fills instantly with `reasoning: "saved answer (used 1x before)"`.

### Forget an answer

1. Settings → Learned answers → click Forget on a row.
2. Toast confirms.
3. Run an application that asks that question → Claude's LLM fallback fires again.

## Failure modes

| Failure | What you see | Mitigation |
|---|---|---|
| localStorage write blocked (private mode) | Settings save silently no-ops; nothing persists | User retypes per session |
| Same question with different wording | LLM fires instead of using saved answer | Re-save once with new wording |
| Profile too large for localStorage | Save silently fails | Forget old entries via Settings |
| `/api/fill` 404 (run already ended) | Inline error on the row, but localStorage still saved | Future runs use the saved answer |
| Stagehand.act fails on the fill | Error event in log, but localStorage still saved | User manually types in the iframe |
| Salary heuristic fills wrong slot | Form's "min salary" field gets the formatted range | User overrides via Settings → record specific labels |

## Performance characteristics

- localStorage reads are synchronous, sub-millisecond.
- Tier 1.5 + 1.6 are O(1) dictionary lookups + a few regex tests. Per-field overhead < 1ms.
- A form with 20 fields, 15 previously-answered: 15 instant hits, 5 LLM calls. Total LLM cost cuts by ~75%.
- The `fillRequests` queue polled every 250ms during `awaiting_review`. Worst-case latency from "Save & fill" click to field fill: ~500ms (queue poll + one Stagehand act call). Typical: ~1–2s including act execution time.

## What's deliberately not in scope (yet)

- **Semantic matching** of question variants via embeddings — would catch "Why this job?" / "What interests you about this role?" / "Why are you applying?" as the same question. Worth doing when we have >50 saved answers and users start hitting variant misses.
- **Server-side profile storage** — required for cross-device sync. Part of the SaaS migration plan (Supabase Postgres).
- **Profile import/export** — handy for backup or moving between browsers. ~30 lines of JSON download/upload UI. Defer until requested.
- **Inferred extras** — could pull salary range from past offer letters, work auth from résumé country flags, etc. Out of scope; LLM extraction risk.
- **Per-ATS answer variants** — same question on Lever vs Ashby might want different phrasing. Currently one answer per question key. v2.
