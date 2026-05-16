# API Reference

Every endpoint exposed by the web app, with request/response shapes and status codes. All routes are in [src/app/api/](../../src/app/api/).

All routes support `OPTIONS` for CORS preflight (returns 204 with `Access-Control-Allow-Origin: *`).

Routes that accept user-provided API keys (`/api/parse-resume`, `/api/start`) use them in-flight and never persist. See [features/keys-settings.md](../features/keys-settings.md).

---

## `POST /api/parse-resume`

Parse a PDF résumé into structured JSON.

### Request

`multipart/form-data` with these fields:

- `file` (required) — PDF, ≤5 MB.
- `anthropicKey` (optional) — user-provided Anthropic API key. If present, used instead of the server's `ANTHROPIC_API_KEY` env var. Used in-flight only; never persisted.

### Response 200

```json
{
  "resume": { /* Resume shape — see reference/types.md */ },
  "pdfBase64": "JVBERi0xLjQK..."
}
```

### Errors

| Status | Body | Meaning |
|---|---|---|
| 400 | `{ "error": "Missing file" }` | Form data didn't include `file` |
| 400 | `{ "error": "PDF too large (max 5 MB)" }` | Over `MAX_PDF_BYTES` |
| 400 | `{ "error": "Only PDFs are supported" }` | MIME type not `application/pdf` |
| 500 | `{ "error": "<anthropic error>" }` | Anthropic API failure or Zod validation error |

### Source

[src/app/api/parse-resume/route.ts](../../src/app/api/parse-resume/route.ts)

---

## `POST /api/start`

Kick off an agent run. Returns immediately with a `runId`; the run continues async in the same Node process.

### Request

```json
{
  "resume": { /* Resume — see reference/types.md */ },
  "pdfBase64": "JVBERi0xLjQK...",
  "jobUrl": "https://jobs.lever.co/company/abc123",
  "provider": "anthropic" | "google",
  "reviewMode": true,
  "userKeys": {
    "anthropic": "sk-ant-...",
    "google": "AIza...",
    "steel": "ste_..."
  }
}
```

Defaults: `provider: "anthropic"`, `reviewMode: true`. `userKeys` is fully optional — each subkey may be omitted, in which case the server uses its env var fallback. Keys are used in-flight only; never persisted. See [features/keys-settings.md](../features/keys-settings.md).

### Response 200

```json
{
  "runId": "5d24c3f8-9a17-4b62-8a55-e5e1a4f2b8d7",
  "liveUrl": "https://app.steel.dev/sessions/abc/live",
  "ats": "lever"
}
```

`liveUrl` may be `null` if Steel didn't provision within 8 seconds. The client should still subscribe to SSE; a `meta` event will eventually deliver the URL.

### Errors

| Status | Body | Meaning |
|---|---|---|
| 400 | `{ "error": "<zod error>" }` | Body didn't match `StartSchema` |
| 400 | `{ "error": "Unsupported ATS..." }` | Hostname not Lever/Greenhouse/Ashby (Workday hard-blocked here) |
| 400 | `{ "error": "Gemini agent isn't configured..." }` | `provider: "google"` but `GOOGLE_GENERATIVE_AI_API_KEY` not set |
| 500 | `{ "error": "..." }` | Unexpected server error |

### Source

[src/app/api/start/route.ts](../../src/app/api/start/route.ts)

---

## `GET /api/events/[runId]`

Server-Sent Events stream of agent events for a run. Replays the run's log on connect, then pipes new events.

### Request

URL only. No body. No `Accept` header required.

### Response

`200` with `Content-Type: text/event-stream`. Stream contents:

```text
event: agent
data: { "id": "...", "runId": "...", "kind": "started", "ts": 1700000000000, "message": "...", "data": { ... } }

event: meta
data: { "runId": "...", "jobUrl": "...", "ats": "lever", "liveUrl": "...", "status": "filling", ... }

event: done
data: { "ok": true }
```

Multiple `agent` events interleave with `meta` events as the run progresses. A `done` event indicates the run has terminated; the server closes the stream.

The client should dedupe `agent` events by `id` (a run's log gets replayed on each new connection).

### Errors

| Status | Body | Meaning |
|---|---|---|
| 404 | `event: error\ndata: { "error": "Run not found" }\n\n` | `runId` not in the in-memory map (process restarted, or pruned after 30 min) |

### Source

[src/app/api/events/[runId]/route.ts](../../src/app/api/events/[runId]/route.ts)

---

## `GET /api/runs/[runId]`

One-shot read of a run's `RunMetadata`. Used by deep-link hydration in the web app.

### Response 200

```json
{
  "meta": {
    "runId": "...",
    "jobUrl": "...",
    "ats": "lever",
    "liveUrl": "...",
    "status": "filling",
    "company": "Acme Inc",
    "startedAt": 1700000000000,
    "finishedAt": null,
    "screenshotUrl": null,
    "error": null
  },
  "eventCount": 12
}
```

### Errors

| Status | Body | Meaning |
|---|---|---|
| 404 | `{ "error": "Run not found" }` | `runId` not in the in-memory map |

### Source

[src/app/api/runs/[runId]/route.ts](../../src/app/api/runs/[runId]/route.ts)

---

## `POST /api/stop/[runId]`

Request the runner stop. The runner checks `isStopRequested(runId)` between steps and throws `StoppedError`.

### Response 200

```json
{ "ok": true }
```

### Errors

| Status | Body | Meaning |
|---|---|---|
| 404 | `{ "error": "Run not found" }` | `runId` not in the in-memory map |

### Source

[src/app/api/stop/[runId]/route.ts](../../src/app/api/stop/[runId]/route.ts)

---

## `POST /api/submit-now/[runId]`

Release a `reviewMode` pause. The runner's `waitForSubmitOrStop()` loop polls for this flag and proceeds with the submit click when set.

### Response 200

```json
{ "ok": true }
```

### Errors

| Status | Body | Meaning |
|---|---|---|
| 404 | `{ "error": "Run not found" }` | `runId` not in the in-memory map |

### Source

[src/app/api/submit-now/[runId]/route.ts](../../src/app/api/submit-now/[runId]/route.ts)

---

## `POST /api/test-keys`

Validate a single API key by making one minimal call against the provider. Used by the Settings page (web + extension) so users can sanity-check keys before kicking off a real run.

### Request

```json
{
  "provider": "anthropic" | "google" | "steel",
  "key": "<the key to test>"
}
```

### Response

Always returns HTTP 200, even when the key is bad — the client renders the result inline rather than as a network error.

**Success:**

```json
{
  "ok": true,
  "info": "Reachable. Model returned 8 tokens. Sample: \"Hello\""
}
```

**Failure (key rejected, rate-limited, network error, etc):**

```json
{
  "ok": false,
  "error": "anthropic rejected the key. Double-check it."
}
```

### Per-provider tests

- **anthropic** — `client.messages.create` with `max_tokens: 8` and content `"hi"`. ~$0.0001/test.
- **google** — REST `generateContent` against `gemini-3-flash-preview` (or `GEMINI_MODEL` env override). Free tier covers.
- **steel** — `GET https://api.steel.dev/v1/sessions?limit=1`. No session creation, $0.

### Errors

| Status | Body | Meaning |
|---|---|---|
| 400 | `{ "error": "<zod error>" }` | Body didn't match the schema |

### Source

[src/app/api/test-keys/route.ts](../../src/app/api/test-keys/route.ts)

---

## `POST /api/fill/[runId]`

Queue a single inline-fill instruction for a run that's paused at `awaiting_review`. The runner's `waitForSubmitOrStop()` drains the queue every ~250ms and executes each entry via `stagehand.act()`, emitting a `field_filled` event when the fill completes.

Used by the LiveRun footer's "Save & fill" button on each skipped required field.

### Request

```json
{
  "label": "Why are you interested in this role?",
  "value": "Your platform shipped the agent SDK I've been studying..."
}
```

### Response 200

```json
{ "ok": true }
```

The fill is queued and will be picked up within ~250ms.

### Errors

| Status | Body | Meaning |
|---|---|---|
| 400 | `{ "error": "Missing label" \| "Missing value" \| "Invalid JSON" }` | Malformed body |
| 404 | `{ "error": "Run not found" }` | `runId` not in the in-memory map (run finished or pruned) |

### Source

[src/app/api/fill/[runId]/route.ts](../../src/app/api/fill/[runId]/route.ts)

See [features/profile-learning.md](../features/profile-learning.md) for the full inline-learn flow.

---

## CORS

All routes return:

```text
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
Access-Control-Max-Age: 86400
```

The wildcard origin is acceptable because **none of these endpoints carry auth cookies**. The Chrome extension reaches them from a `chrome-extension://<id>` origin, which would normally trigger a preflight.

Source: [src/lib/cors.ts](../../src/lib/cors.ts).
