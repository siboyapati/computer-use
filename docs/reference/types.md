# Type Reference

Every shape worth knowing, with the file it lives in.

---

## `Resume`

Canonical answer source for the agent. Zod-validated.

**File:** [src/lib/agent/types.ts](../../src/lib/agent/types.ts)

```ts
{
  personal: {
    fullName:   string;
    firstName:  string;
    lastName:   string;
    email:      string;           // valid email OR ""
    phone:      string;           // defaults to ""
    location:   string;
    linkedin:   string;
    github:     string;
    website:    string;
  };
  headline:    string;
  summary:     string;
  experience: Array<{
    company:     string;
    title:       string;
    startDate:   string;          // "Jan 2024" style
    endDate:     string;          // "Present" if current
    location:    string;
    description: string;
  }>;
  education: Array<{
    school:    string;
    degree:    string;
    field:     string;
    startDate: string;
    endDate:   string;
  }>;
  skills:         string[];
  projects: Array<{
    name:        string;
    description: string;
    url:         string;
  }>;
  certifications: string[];
}
```

Required: only `personal.{fullName, firstName, lastName, email}` (and the company name + title on each `experience` entry, and `school` on each `education` entry). Everything else defaults to `""` or `[]`.

The extension mirrors this type in [extension/src/lib/types.ts](../../extension/src/lib/types.ts).

---

## `ATS`

```ts
type ATS = "lever" | "greenhouse" | "ashby";
```

Workday and others return `null` from `detectATS`. The API rejects them with 400.

---

## `LLMProvider`

```ts
type LLMProvider = "anthropic" | "google";
```

Resolved server-side to a Stagehand `modelName` like `"anthropic/claude-haiku-4-5"` or `"google/gemini-3-flash-preview"`.

---

## `AgentEvent`

Single event in the SSE stream.

**File:** [src/lib/agent/types.ts](../../src/lib/agent/types.ts)

```ts
type AgentEventKind =
  | "started"          // run kicked off / session ready
  | "navigated"        // page.goto fired or completed
  | "form_extracted"   // form schema read; data.fieldCount + data.fields
  | "field_filled"     // a single field filled; data.label + data.value (redacted) + data.reasoning
  | "file_uploaded"    // resume PDF uploaded; data.ok
  | "awaiting_review"  // review-mode pause hit
  | "submitting"       // submit click fired
  | "submitted"        // run finished successfully
  | "screenshot"       // screenshot captured; data.url (data: URI)
  | "stopped"          // user clicked Stop or review-mode timed out
  | "error"            // non-fatal step error or fatal run error
  | "completed";       // (reserved, currently unused)

interface AgentEvent {
  id: string;            // uuid
  runId: string;
  kind: AgentEventKind;
  ts: number;            // Date.now() at emit time
  message: string;       // user-facing one-liner
  data?: Record<string, unknown>;
}
```

---

## `RunStatus`

```ts
type RunStatus =
  | "starting"
  | "navigating"
  | "filling"
  | "awaiting_review"
  | "submitting"
  | "submitted"
  | "failed"
  | "stopped";
```

Lives on `RunMetadata.status`. The phase strip + status pill in the UI render off this value.

---

## `RunMetadata`

The "current state" object for a run. Updated as the run progresses.

**File:** [src/lib/agent/types.ts](../../src/lib/agent/types.ts)

```ts
interface RunMetadata {
  runId:         string;
  jobUrl:        string;
  ats:           ATS;
  liveUrl:       string | null;            // Steel sessionViewerUrl, null until provisioned
  status:        RunStatus;
  company:       string | null;            // populated by form_extracted
  startedAt:     number;
  finishedAt:    number | null;
  screenshotUrl: string | null;            // "data:image/png;base64,..."
  error:         string | null;
}
```

---

## `FormField`

What the ATS adapter's `extract()` returns for each field.

**File:** [src/lib/agent/field-mapper.ts](../../src/lib/agent/field-mapper.ts)

```ts
interface FormField {
  label:    string;
  type:     "text" | "email" | "phone" | "url" | "textarea" | "select" | "radio" | "checkbox" | "file" | "other";
  required: boolean;
  options?: string[];   // for select / radio
}
```

---

## `FieldAnswer`

What `mapField()` returns.

```ts
interface FieldAnswer {
  label:     string;
  value:     string;          // empty string means "skip this field"
  reasoning: string;          // "matched resume directly" | "EEO question — picked X" | "generated from resume"
}
```

The `reasoning` is included in the SSE event data so users can see why a field got the value it got.

---

## `StoredResume` (client localStorage)

**File:** [src/lib/storage.ts](../../src/lib/storage.ts)

```ts
interface StoredResume {
  resume:     Resume;
  pdfBase64:  string;
  fileName:   string;
  storedAt:   number;
}
```

Stored under key `autoapply.resume.v1`.

---

## `HistoryItem` (client localStorage)

**File:** [src/lib/storage.ts](../../src/lib/storage.ts)

```ts
interface HistoryItem {
  runId:         string;
  company:       string | null;
  jobUrl:        string;
  status:        "submitted" | "failed" | "stopped";
  ats:           ATS;
  screenshotUrl: string | null;
  finishedAt:    number;
}
```

Stored under key `autoapply.history.v1` as an array, capped at 5 (newest first).

---

## `AppState` (client reducer)

**File:** [src/lib/client-types.ts](../../src/lib/client-types.ts)

```ts
type AppPhase = "landing" | "parsing" | "confirm" | "starting" | "live" | "done";

interface AppState {
  phase:        AppPhase;
  resume:       Resume | null;
  pdfBase64:    string | null;
  fileName:     string | null;
  jobUrl:       string;
  runId:        string | null;
  liveUrl:      string | null;
  ats:          ATS | null;
  provider:     LLMProvider;
  events:       AgentEvent[];
  meta:         RunMetadata | null;
  error:        string | null;
}
```

---

## `StoredConfig` (extension chrome.storage.local)

**File:** [extension/src/lib/types.ts](../../extension/src/lib/types.ts)

```ts
type StoredConfig =
  | { paired: false }
  | {
      paired:    true;
      apiBase:   string;       // e.g. "http://localhost:3000"
      resume:    Resume;
      pdfBase64: string;
      fileName:  string;
      pairedAt:  number;
    };
```

Stored under key `autoapply.config.v1`.

---

## Extension message types

```ts
interface PairMessage {
  type:      "pair";
  resume:    Resume;
  pdfBase64: string;
  fileName:  string;
  apiBase:   string;
}

interface ApplyMessage {
  type:   "apply";
  jobUrl: string;
}

interface StatusMessage {
  type: "get-status";
}
```

Sent via `chrome.runtime.sendMessage` (internal) or `chrome.runtime.sendMessage(extId, ...)` (external, from the web app's `/connect` page).
