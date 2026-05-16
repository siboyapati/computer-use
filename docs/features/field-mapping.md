# Feature — Field Mapping

## What

Given a form field (label, type, options), a parsed `Resume`, an optional `UserProfile`, and the job URL, return the value the agent should fill.

The mapper uses a cheapest-first strategy:

1. **Deterministic dictionary** — regex on the label -> key into `Resume`. Zero LLM tokens.
2. **EEO privacy guard** — if the label looks demographic, pick an explicit decline option when present; otherwise leave blank.
3. **Profile extras** — structured saved values such as work authorization, salary, start date, relocation, and referral source.
4. **Saved answers** — exact normalized key first, then local semantic question matching for wording variants.
5. **LLM fallback** — single Claude call with the resume in a cacheable system prompt.

## Why

The naive "ask Claude for every field" path costs more and adds latency. The naive hardcoded path fails on custom questions such as "Why are you interested in this role?"

This tiering keeps common fields instant, protects demographic fields, reuses the user's own saved answers for repeat questions, and only asks the model when the app has no grounded answer.

## How

### Files

- [src/lib/agent/field-mapper.ts](../../src/lib/agent/field-mapper.ts) — full mapping logic.
- [src/lib/agent/profile-types.ts](../../src/lib/agent/profile-types.ts) — profile types, normalization, extras matching, and local semantic question embeddings.
- [src/lib/profile.ts](../../src/lib/profile.ts) — client-side profile persistence and preview helpers.

### Entry point

```ts
export async function mapField(field, resume, jobUrl, apiKey, profile): Promise<FieldAnswer> {
  const det = deterministicAnswer(field, resume);
  if (det) return { label, value: det, reasoning: "matched resume directly" };

  if (EEO_REGEX.test(field.label)) {
    const decline = findDeclineOption(field.options);
    return {
      label,
      value: decline ?? "",
      reasoning: decline
        ? `EEO question — picked "${decline}"`
        : "EEO question — no decline option, left blank",
    };
  }

  const profileHit = profileAnswer(field, profile);
  if (profileHit) return profileHit;

  const value = await answerCustomQuestion(field, resume, jobUrl, apiKey);
  return { label, value, reasoning: "generated from resume" };
}
```

### Tier 1 — Deterministic dictionary

The `DETERMINISTIC` array maps common labels to `Resume` fields:

- name, first name, last name
- email, phone
- LinkedIn, GitHub, portfolio / website
- city / location
- current company / title
- school / degree
- headline

The first non-empty match wins. Empty results fall through so missing resume fields do not block better fallback behavior.

### Tier 1.5 — EEO privacy guard

```ts
const DECLINE_REGEX = /decline|prefer not|do not wish|don.?t wish|rather not|not.*say|not.*answer|wish.*disclose/i;
const EEO_REGEX = /race|ethnic|gender|disab|veteran|hispanic|latino|sex\b|pronoun|orientation|identify/i;
```

If a field looks demographic, the mapper searches its options for a decline-style answer such as "Prefer not to say". If none exists, it returns an empty string and the runner skips the field.

Important: the mapper does **not** fall back to the last dropdown option. A last option may be a real demographic answer, so silently submitting it would be a privacy bug. Because this tier runs before profile saved answers, even a previously saved demographic answer cannot be reused automatically.

### Tier 1.6 — Profile extras

`matchExtra()` maps labels to structured profile fields:

```ts
matchExtra("Are you authorized to work in the US?") // "workAuthorization"
matchExtra("Salary expectations")                  // "salaryMin"
matchExtra("Earliest start date")                  // "earliestStartDate"
matchExtra("Are you willing to relocate?")         // "willingToRelocate"
matchExtra("How did you hear about us?")           // "howDidYouHear"
```

For salary questions, the mapper formats a range when both min and max are available. Booleans become `Yes` / `No`. For select fields, saved free-form answers are coerced to matching options where safe, so "Yes, I am authorized..." can fill a `Yes` option.

### Tier 1.7 — Saved answers

Saved answers are keyed by `normalizeQuestion(label)`, which strips case, trailing required markers, punctuation, and repeated whitespace.

Exact matches are tried first. If exact lookup misses, `findBestSemanticQuestionMatch()` builds a small local semantic embedding from:

- normalized tokens and bigrams
- aliases such as `job`, `position`, and `opportunity` -> `role`
- intent concepts for motivation, work authorization, sponsorship, compensation, start date, referral source, relocation, experience, and additional info
- low-weight character n-grams for spelling variants

This catches variants such as:

- saved: "Why are you interested in this role?"
- incoming: "Why this job?"
- incoming: "What interests you?"
- incoming: "What interests you about this opportunity?"

Accepted semantic matches emit reasoning like `"semantic saved answer (55% match)"`.

### Tier 3 — LLM fallback with prompt caching

For anything still unresolved, `answerCustomQuestion()` asks Claude for a grounded answer:

- system block: cacheable resume JSON with `cache_control: { type: "ephemeral" }`
- user block: field label, field type, options, and "Return ONLY the value"
- max tokens: shorter for inputs, larger for textareas

If the model cannot answer from the resume, it is instructed to return an empty string. The runner skips empty values and surfaces required skipped fields in review mode.

### Dropdown option coercion

Profile and LLM answers can be free-form while ATS select fields expect exact options. Before returning profile or LLM values, the mapper tries safe coercions:

- exact option
- case-insensitive option
- normalized punctuation-insensitive option
- yes/no intent, including "No, I do not require sponsorship" -> `No`
- later/future intent for sponsorship-style fields

If none of these are clear, the original answer is preserved and Stagehand gets a chance to fill it.

## Gotchas

- **Semantic matching is local, not hosted.** It is deterministic and cheap, but not a general-purpose embedding model.
- **EEO fields without decline options are left blank.** Review mode lets the user decide manually.
- **Salary questions are inherently fuzzy.** A single salary-shaped label may mean minimum, desired, or range. Users can override specific labels in the Saved Answer Library.
- **Prompt cache hits depend on identical resume-block bytes.** Keep `JSON.stringify(resume, null, 2)` stable.
- **No retry on provider 429.** A per-field error logs and the run continues.

## Verification

Automated semantic/profile coverage:

```bash
npm run test:semantic
```

Type and lint checks:

```bash
npx tsc --noEmit
npm run lint
```

Manual smoke test:

1. Visit `/settings`.
2. Save work authorization and a reusable answer for "Why are you interested in this role?"
3. Run a Lever/Greenhouse/Ashby application with review mode on.
4. Confirm event-log reasoning:
   - `"matched resume directly"` -> deterministic tier
   - `"EEO question — picked ..."` or `"no decline option, left blank"` -> EEO privacy guard
   - `"profile: workAuthorization"` -> profile extras
   - `"saved answer"` or `"semantic saved answer (...% match)"` -> Saved Answer Library
   - `"generated from resume"` -> LLM fallback

## Failure modes

| Failure | What you see | Mitigation |
|---|---|---|
| Common field falls through to LLM | More tokens spent than necessary | Add regex to `DETERMINISTIC` |
| EEO field with no decline option | Field skipped, required row appears in review mode | User fills manually |
| Saved answer variant below threshold | LLM fallback fires | Add that wording as a custom saved answer or tune semantic patterns |
| Select option cannot be coerced | Deterministic select fill fails, Stagehand `act()` fallback tries | Add a saved answer that matches the ATS option text |
| LLM hallucinates | Wrong value gets filled | Review mode catches this before submit |
| Form has 80 fields | Capped at 40, error event emitted | User fills remaining fields manually |
