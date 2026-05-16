# Feature — ATS Adapters

## What

Per-platform code that handles the specific quirks of Lever, Greenhouse, and Ashby. Each adapter exposes three functions:

```ts
extract(stagehand): Promise<ExtractedForm>     // ATS-tuned stagehand.extract prompt
upload(stagehand, pdfPath): Promise<boolean>   // CSS selector chain → setInputFiles
submit(stagehand): Promise<void>               // deterministic click; act() fallback
```

The runner picks the adapter based on `detectATS(jobUrl)` and dispatches.

## Why

A single "generic" adapter doesn't work. Each ATS has unique gotchas:

| ATS | Notable quirks |
|---|---|
| **Lever** | Native HTML inputs, clean DOM, `input[name="resume"]`. Easiest. |
| **Greenhouse** | `intl-tel-input` phone field needs a country code dropdown, `react-select` for custom Qs, `#resume` is sometimes a `<label>` wrapper not the input itself. |
| **Ashby** | Full React SPA with hashed CSS class names. Must target by labels and ARIA roles, not classes. Hidden file input lives under a drag-drop overlay. |

A generic extractor would either:
- **Over-fetch** (bring back nav links and footer text), or
- **Under-fetch** (miss `intl-tel-input` and custom react-select dropdowns).

ATS-tuned prompts to `stagehand.extract()` solve this with ~80 lines of code per adapter.

## How

### Files

- [src/lib/agent/adapters/lever.ts](../../src/lib/agent/adapters/lever.ts)
- [src/lib/agent/adapters/greenhouse.ts](../../src/lib/agent/adapters/greenhouse.ts)
- [src/lib/agent/adapters/ashby.ts](../../src/lib/agent/adapters/ashby.ts)

### Dispatch table

[runner.ts](../../src/lib/agent/runner.ts):

```ts
const ADAPTERS: Record<ATS, { extract; upload; submit }> = {
  lever: { extract: extractLeverForm, upload: leverUpload, submit: leverSubmit },
  greenhouse: { extract: extractGreenhouseForm, upload: ghUpload, submit: ghSubmit },
  ashby: { extract: extractAshbyForm, upload: ashbyUpload, submit: ashbySubmit },
};
```

### Common `ExtractedForm` shape

```ts
interface ExtractedForm {
  company: string;
  fields: FormField[];           // { label, type, required, options? }
  resumeFieldLabel: string | null;  // label of the file-upload field, if any
}
```

The `resumeFieldLabel` is the agent's signal that the form expects a résumé upload. If `null`, the agent skips the upload step.

### Lever

[adapters/lever.ts](../../src/lib/agent/adapters/lever.ts):

```ts
// extract — Zod-typed schema
const result = await stagehand.extract(
  "Extract the company name and every visible form field on this Lever job application page. Include text inputs, textareas, dropdowns, radio groups, checkboxes, and file uploads. For radio/select, include the option labels. Skip fields that are clearly section headers or links.",
  LeverFormSchema,
);

// upload — selector chain
const candidates = [
  'input[type="file"][name="resume"]',
  'input[type="file"][name*="resume" i]',
  'input[type="file"][id*="resume" i]',
  'input[type="file"][accept*="pdf" i]',
  'input[type="file"]',
];

// submit — deterministic first, act() fallback
const candidates = [
  'button[type="submit"]',
  'xpath=//button[contains(translate(., "ABC...", "abc..."), "submit")]',
  'input[type="submit"]',
];
```

### Greenhouse

[adapters/greenhouse.ts](../../src/lib/agent/adapters/greenhouse.ts):

```ts
// extract — explicit mention of the gotcha widgets
"Extract the company and every visible form field on this Greenhouse application page. Be sure to include the international phone field (intl-tel-input) and any react-select dropdowns for custom questions. For demographic / EEO questions list the dropdown options. Skip section headers and informational text."

// upload — scope `#resume` to input only (avoid matching the wrapping <label>)
const candidates = [
  'input[type="file"]#resume',
  'input[type="file"][id*="resume" i]',
  'input[type="file"][name*="resume" i]',
  'input[type="file"][accept*="pdf" i]',
  'input[type="file"]',
];

// submit — Greenhouse posting forms usually have id="submit_app"
const candidates = [
  'button[type="submit"]#submit_app',
  'button[type="submit"]',
  'input[type="submit"]',
  'xpath=//button[contains(translate(., "ABC...", "abc..."), "submit")]',
];
```

**Why `input[type="file"]#resume` and not just `#resume`?** Some Greenhouse templates render a `<label for="resume">` wrapper that has `id="resume"` on the label itself. The naked `#resume` selector would resolve to the label and `setInputFiles` would throw "expected file input." Scoping with `input[type="file"]` removes the ambiguity.

### Ashby

[adapters/ashby.ts](../../src/lib/agent/adapters/ashby.ts):

```ts
// extract — Ashby is SPA, target by labels / roles
"Extract the company name and every visible form field on this Ashby application page. Ashby is a single-page React app — target fields by their labels and ARIA roles, not class names. Include any role='combobox' dropdowns and role='radiogroup' radios with their option labels."

// upload — Ashby hides the real input under a drag-drop overlay
const candidates = [
  'input[type="file"][accept*="pdf" i]',
  'input[type="file"][name*="resume" i]',
  'input[type="file"]',
];

// submit — variant button text
const candidates = [
  'button[type="submit"]',
  'xpath=//button[contains(translate(., "ABC...", "abc..."), "submit application")]',
  'xpath=//button[contains(translate(., "ABC...", "abc..."), "submit")]',
];
```

### The `translate()` XPath idiom

XPath 1.0 (which the browser ships) has no `lower-case()` function. To do case-insensitive `contains()`, we use `translate(., "ABC...XYZ", "abc...xyz")` to lowercase the string, then `contains(lowered, "submit")`.

This is the canonical XPath case-insensitive pattern. Looks awkward, works everywhere.

### Why deterministic-first submit

Originally the submit was `stagehand.act("Click the Submit application button")`. Two problems:

1. **Non-determinism** — the LLM could click a different button (e.g., a "Save and submit later" button) on a complex form.
2. **Latency** — `act()` runs a full LLM call. CSS selectors are instant.
3. **Cost** — every submit click costs LLM tokens unnecessarily.

The deterministic chain handles 99%+ of cases. The `act()` fallback is there for the one form per quarter that uses a weird custom submit button with no `type="submit"`.

## Gotchas

- **`isVisible()` returns `false` for hidden file inputs.** ATS file inputs are nearly always `display: none` (the visible "Attach" button proxies the click). Our upload chains use `count() > 0` instead — works regardless of visibility.
- **Greenhouse `intl-tel-input` country picker.** The agent fills the phone number into the text field, but it may not select the country code. For now this is acceptable — most ATSes accept a fully-qualified `+1 415 ...` number. v2 could explicitly click the country dropdown.
- **Ashby's drag-drop overlay** intercepts clicks. The hidden `<input type="file">` is reachable directly, but if our selector misses it, `act("Upload the résumé")` will try to drag-drop — which Stagehand can't do.
- **`label[for=...]` mismatches.** If the label uses `for="resume"` but the input has `name="resume"` without a matching `id`, the deterministic XPath fallback (`//label[…]/following::input[1]`) catches it.
- **Greenhouse EU host** (`job-boards.eu.greenhouse.io`) — same DOM as the US host, currently handled by the same adapter. If we hit EU-specific quirks (cookie banner blocking the form), add a per-host adapter.
- **Legacy Greenhouse host** (`boards.greenhouse.io`) — deprecated April 2025. New postings use `job-boards.greenhouse.io`. Our `detectATS` matches both via `endsWith(".greenhouse.io")`.

## Adding a new ATS

Roughly ~50 lines of code:

1. Add the host pattern to `detectATS` in [src/lib/agent/types.ts](../../src/lib/agent/types.ts).
2. Create `src/lib/agent/adapters/<ats>.ts` with `extractXxxForm`, `uploadResume`, `clickSubmit`.
3. Wire into `ADAPTERS` in [src/lib/agent/runner.ts](../../src/lib/agent/runner.ts).
4. Update `host_permissions` and `content_scripts.matches` in [extension/package.json](../../extension/package.json) so the Chrome extension recognizes it too.
5. Add an entry to [02 — Features](../02-features.md) if it's user-visible.

We've **explicitly not added Workday** because of bot detection + 10+ paginated pages + cost runaway. See [02 — Features → Deferred](../02-features.md#deferred-considered-not-built).

## Verification

For each ATS, find one real posting and run an application end-to-end:

```text
✓ Lever:       https://jobs.lever.co/<company>/<id>
✓ Greenhouse:  https://job-boards.greenhouse.io/<company>/jobs/<id>
✓ Ashby:       https://jobs.ashbyhq.com/<company>/<id>
```

For each:

1. Drop your résumé on the web app.
2. Paste the URL, click Start.
3. Watch the live browser.
4. Verify:
   - All required fields filled.
   - Résumé uploaded (the file chip appears).
   - Submit click fires the right button (page navigates to confirmation).
   - Screenshot shows the post-submit confirmation page.

If any step fails, look at the event log — the `form_extracted` event includes the field list, so you can see what the extractor saw vs what's actually on the page.

## Failure modes

| Failure | What you see | Mitigation |
|---|---|---|
| Wrong fields extracted (missing custom Q) | Form has 5 fields, extractor returned 3 | Tighten the extract prompt; add explicit hint for the missing widget pattern |
| Resume upload fails (`ok: false`) | "Resume upload failed" event in log | Add more selector candidates; check if the form's file input is in an iframe (rare) |
| Submit clicks the wrong button | Page doesn't navigate after submit; agent retries via act() | Inspect the form's HTML and add a more specific selector to the chain |
| Greenhouse EU cookie banner blocks form | Form fields not visible, extract returns 0 fields | Add a click-cookie-banner pre-step (not implemented yet) |
| Ashby SPA hasn't hydrated | Same as above | `waitForSelector` covers most cases; bump the timeout if your network is slow |
