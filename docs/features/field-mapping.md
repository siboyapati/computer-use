# Feature — Field Mapping

## What

Given a form field (label, type, options) and a parsed `Resume` + the job URL, return the value the agent should fill into that field. The mapping uses a three-tier strategy:

1. **Deterministic dictionary** — regex on the label → key into `Resume`. Zero LLM tokens.
2. **EEO heuristic** — if the label looks demographic, pick the first "decline to answer" option, or fall back to the last option to avoid blocking submit on a required field.
3. **LLM fallback** — single Claude call with the résumé in the cacheable system prompt, asking it to generate an answer grounded in the résumé.

## Why

The naive approach — "ask Claude what to put in every field" — costs too much (one LLM call per field × ~20 fields = $$$) and adds latency (~1s per call × 20 = 20s overhead per application).

The naive deterministic approach — "hardcode common labels" — fails on custom questions like *"Why are you interested in this role?"* or *"Describe a project you're proud of."*

The three-tier strategy hits the sweet spot:

- **Common identity fields** (name, email, phone, LinkedIn) — deterministic, zero cost. Covers ~60% of typical ATS forms.
- **EEO / demographic** — heuristic + decline-by-default. Privacy-respecting, requires no user input.
- **Custom prose** — LLM, but with **prompt caching** on the résumé block so the per-question cost is just the question + answer tokens (not the full résumé every time).

## How

### Files

- [src/lib/agent/field-mapper.ts](../../src/lib/agent/field-mapper.ts) — the full mapping logic.

### Entry point

```ts
export async function mapField(field, resume, jobUrl): Promise<FieldAnswer> {
  // 1. Deterministic
  const det = deterministicAnswer(field, resume);
  if (det) return { label, value: det, reasoning: "matched resume directly" };

  // 2. EEO heuristic
  if (EEO_REGEX.test(field.label)) {
    const decline = findDeclineOption(field.options);
    return { label, value: decline ?? "", reasoning: "EEO question — picked decline" };
  }

  // 3. LLM fallback
  const value = await answerCustomQuestion(field, resume, jobUrl);
  return { label, value, reasoning: "generated from resume" };
}
```

### Tier 1 — Deterministic dictionary

```ts
const DETERMINISTIC: Array<{ match: RegExp; key: (r: Resume) => string }> = [
  { match: /^(full\s*)?name$/i,          key: (r) => r.personal.fullName },
  { match: /first\s*name|given\s*name|forename/i, key: (r) => r.personal.firstName },
  { match: /last\s*name|surname|family\s*name/i,  key: (r) => r.personal.lastName },
  { match: /^e?-?mail( address)?$/i,     key: (r) => r.personal.email },
  { match: /phone|mobile|cell|telephone/i, key: (r) => r.personal.phone },
  { match: /linked\s*in/i,               key: (r) => r.personal.linkedin },
  { match: /github|git hub/i,            key: (r) => r.personal.github },
  { match: /portfolio|website|personal\s*site|url/i, key: (r) => r.personal.website },
  { match: /^(city|location|where.*based|address|current location)/i, key: (r) => r.personal.location },
  { match: /current\s*(company|employer)/i, key: (r) => r.experience[0]?.company ?? "" },
  { match: /current\s*(title|role|position)/i, key: (r) => r.experience[0]?.title ?? "" },
  { match: /^school|university|college/i, key: (r) => r.education[0]?.school ?? "" },
  { match: /^degree/i,                   key: (r) => r.education[0]?.degree ?? "" },
  { match: /^headline|tagline/i,         key: (r) => r.headline },
];
```

The first match wins. Empty results fall through (so a `linkedin` field on a résumé without a LinkedIn URL goes to the LLM fallback, which will likely return an empty string).

### Tier 2 — EEO heuristic

```ts
const DECLINE_REGEX = /decline|prefer not|do not wish|don.?t wish|rather not|not.*say|not.*answer|wish.*disclose/i;
const EEO_REGEX = /race|ethnic|gender|disab|veteran|hispanic|latino|sex\b|pronoun|orientation|identify/i;

function findDeclineOption(options: string[] | undefined): string | undefined {
  if (!options || options.length === 0) return undefined;
  return options.find((o) => DECLINE_REGEX.test(o)) ?? options[options.length - 1];
}
```

If the field is demographic AND has options (a dropdown or radio group):

1. Look for an option matching `DECLINE_REGEX`.
2. If none found, **fall back to the last option** in the list.

The fallback is critical: if the field is required and we leave it blank, submit silently fails. Picking *any* option (typically "Other" or a similar last entry) keeps the application valid. Yes, this is a compromise — but the alternative (asking the user mid-run) breaks the demo flow.

Privacy posture: declining by default is the safest play. Some users will want to opt in (e.g., to qualify for diversity programs). That's a **deferred** feature — would require a toggle in the Confirm screen and per-category storage.

### Tier 3 — LLM fallback with prompt caching

```ts
async function answerCustomQuestion(field, resume, jobUrl): Promise<string> {
  const isLong = field.type === "textarea";
  const resumeBlock = `You are filling out a job application on behalf of a candidate. Answer concisely and truthfully based ONLY on the candidate's resume. Do not invent experience. If the question asks "why are you interested", reference real overlap between the candidate's background and the role. If you genuinely cannot answer from the resume, return an empty string.

Candidate resume (JSON):
${JSON.stringify(resume, null, 2)}`;

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: isLong ? 400 : 80,
    system: [
      { type: "text", text: resumeBlock, cache_control: { type: "ephemeral" } },  // ← prompt cache
      { type: "text", text: `Job URL: ${jobUrl}` },
    ],
    messages: [{
      role: "user",
      content: `Form field label: "${field.label}"
Field type: ${field.type}
${field.options ? `Options (pick one verbatim if matching): ${field.options.join(" | ")}` : ""}

Return ONLY the value to enter into this field. No preamble, no quotes, no commentary.`,
    }],
  });

  // Strip surrounding quotes if the model wrapped its answer
  return text.trim().replace(/^["']|["']$/g, "");
}
```

#### Why prompt caching matters

A typical custom-question form has 3–10 questions. Without caching:

- 10 questions × ~2 KB résumé JSON × 1M tokens per $1 input = ~$0.02 per form
- 10 sequential API calls = ~10 seconds of latency

With `cache_control: { type: "ephemeral" }` on the résumé block:

- First call writes the cache (~$0.025 × 1.25 base rate).
- Subsequent 9 calls hit the cache (~$0.025 × 0.1 cache rate).
- Total ~70% cheaper on input tokens, plus latency benefits.

The cache key is hashed from the system prompt, so two runs on the same résumé share the cache window (5 min TTL on Anthropic). Two users with different résumés get separate cache entries.

#### Why "return an empty string" for unanswerable questions

If the LLM can't ground an answer in the résumé, we'd rather skip the field than hallucinate. The runner skips fields with empty values:

```ts
if (!answer.value) {
  emit("field_filled", `Skipped ${label} (no value)`, { skipped: true });
  continue;
}
```

The user sees the skip in the event log and can manually fill the field in the live browser before clicking "Submit for real" (review mode).

### Hard caps

The runner applies a per-run cap before iterating:

```ts
const MAX_FIELDS_TO_FILL = 40;
const fillable = form.fields.filter((f) => f.type !== "file").slice(0, MAX_FIELDS_TO_FILL);
```

If the form has more than 40 fillable fields, we cap and emit an error event so the user knows. 40 is more than any reasonable ATS form should have; this is the cost-runaway guard.

## Gotchas

- **Field labels with trailing asterisks** (`"Email *"`) — the runner strips trailing `*` in `tryFillByLabel`, but the field-mapper sees the raw label. If a deterministic regex doesn't match because of `*`, we fall to LLM. The LLM does the right thing anyway.
- **`current company` matches "Why do you want to work at our current company?"** — overly broad regex would mismap. We anchor with `current\s*(company|employer)` which is reasonably tight, but a malicious or weird label could still hit it. The LLM fallback handles edge cases.
- **EEO regex `disab` matches "disable account"** — unlikely in a job application form, but worth knowing. In practice the only place we see `disab` is in disability disclosure questions.
- **Empty option lists.** If an EEO question is a free-text field instead of a dropdown, `findDeclineOption` returns `undefined` → empty value → field skipped. This is correct: don't disclose what wasn't asked as multiple-choice.
- **Cache hits depend on identical system prompt bytes.** Reformatting the résumé JSON (changing whitespace, key order) blows the cache. Stick with `JSON.stringify(resume, null, 2)`.
- **No retry on Anthropic 429.** Single failure → empty value → field skipped. User sees the skip and can fill manually.

## Verification

The field-mapper has no standalone smoke test (it's an internal function). Verify indirectly via the agent runner:

1. Run a real application on a Lever job with a known set of fields.
2. Watch the event log — each "Filled ..." event includes a `reasoning` field in its `data`:
   - `"matched resume directly"` → deterministic tier
   - `"EEO question — picked decline"` or `"...left blank"` → EEO tier
   - `"generated from resume"` → LLM tier
3. Confirm via cost monitoring that the total run cost is well under $0.10 (most should land at $0.02–$0.05).

If too many fields say `"generated from resume"`, the deterministic dictionary needs an entry. Add a regex + key mapping in the `DETERMINISTIC` array.

## Failure modes

| Failure | What you see | Mitigation |
|---|---|---|
| Common field falls through to LLM | More tokens spent than necessary, but still works | Add regex to `DETERMINISTIC` |
| EEO field with no decline option | Last option auto-picked, may not be what user wants | Acceptable for demo; v2 = user opt-in toggle |
| LLM hallucinates | Wrong value gets filled | Review mode catches this; user fixes manually before submit |
| Anthropic rate-limit | Per-field call fails; field skipped | Other fields still proceed; user re-runs or fills manually |
| Form has 80 fields | Capped at 40, error event emitted | The user can fill remaining manually in the live browser before "Submit for real" |
