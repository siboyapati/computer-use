# Feature — Settings Page (Bring Your Own API Keys)

## What

A Settings page on both the web app (`/settings`) and the Chrome extension (options page) where users enter their own Anthropic, Steel, and Google Gemini API keys. Each key has:

- A masked display (`sk-a…XYZ4`) once saved.
- A "Test" button that hits a server endpoint which makes one minimal API call against the provider and reports back ok / error.
- Show/hide toggle while typing.
- Per-row Clear button + a "Forget all keys" action.

Keys are stored client-side (localStorage for the web, `chrome.storage.local` for the extension) and shipped to the server **only during a run** — never persisted server-side. If no key is configured, the server falls back to its own `.env.local` values.

Also: a gear icon in the top-right of the web app links to `/settings`.

## Why

Without this, every run on the hosted demo bills the operator's Anthropic + Steel credits. That's fine for the founder, doesn't scale to anyone else. Two options for fixing it:

1. **Operator-side per-user accounting** (auth + database + Stripe usage metering) — that's the SaaS, not the demo.
2. **User-side BYO keys** — anyone can use the hosted demo with their own provider accounts, no server-side billing.

Option 2 ships in a weekend, costs nothing, and respects the demo's "single-process, no DB" architecture.

The test buttons are a separate ask but solve a real problem: pasting a bad key, kicking off a run, and waiting until the agent fails mid-fill is a terrible UX. One-click test on each key gives immediate green/red feedback.

## How

### Files

**Web app:**
- [src/app/settings/page.tsx](../../src/app/settings/page.tsx) — the Settings UI.
- [src/lib/keys.ts](../../src/lib/keys.ts) — localStorage helpers + `maskKey()` + `keysForRequest()`.
- [src/app/api/test-keys/route.ts](../../src/app/api/test-keys/route.ts) — POST endpoint that tests a single key.
- [src/lib/agent/keys.ts](../../src/lib/agent/keys.ts) — server-side resolver: prefer user-provided, fall back to env.
- [src/app/page.tsx](../../src/app/page.tsx) — Brand component renders the gear; `onStart` callback attaches `userKeys` from localStorage to `/api/start`.
- [src/components/landing.tsx](../../src/components/landing.tsx) — `handleFile` appends `anthropicKey` to the parse-resume multipart payload if present.

**Extension:**
- [extension/src/options.tsx](../../extension/src/options.tsx) — KeysSection + KeyRow components, mirrors the web Settings.
- [extension/src/lib/storage.ts](../../extension/src/lib/storage.ts) — `updateUserKeys()` merges with existing config; `maskKey()` helper.
- [extension/src/lib/api.ts](../../extension/src/lib/api.ts) — `testKey()` proxies to the web app's `/api/test-keys`; `startApplication()` now includes `userKeys` in the body.
- [extension/src/lib/types.ts](../../extension/src/lib/types.ts) — `UserKeys` type, added to `PairedConfig` and unpaired storage.

### Data flow — web app

```text
User pastes key on /settings → saveKeys(...) → localStorage
                                                    ↓
User clicks Test on a row → POST /api/test-keys { provider, key }
                              → server makes one minimal API call to provider
                              → returns { ok, info?, error? }
                              → UI renders green or red banner
                                                    ↓
User drops a résumé on Landing → handleFile()
                              → reads localStorage via dynamic import of @/lib/keys
                              → form.append("anthropicKey", stored.anthropic)
                              → POST /api/parse-resume (multipart)
                              → parse-resume route picks up the field, passes to parseResumeFromPdf()
                                                    ↓
User clicks Start on Confirm → loadKeys() → keysForRequest()
                              → POST /api/start { ..., userKeys }
                              → start route validates required keys upfront
                                (returns 400 if missing both env + user override)
                              → runApplication() receives userKeys
                              → resolveStagehandModel(provider, userKeys)
                              → Steel createSession(userKeys.steel)
                              → mapField(field, resume, jobUrl, userKeys.anthropic)
```

### Data flow — extension

```text
User opens options page → KeysSection renders three KeyRows
                       → Each row reads from config.userKeys
                                                    ↓
User types + clicks Save → updateUserKeys({ [provider]: value })
                        → merges with existing chrome.storage.local
                        → preserves paired status (résumé still pinned)
                                                    ↓
User clicks Test → api.testKey(apiBase, provider, key)
                → POST `${apiBase}/api/test-keys`
                → renders result inline
                                                    ↓
Floating button clicked on a job page → background sendMessage "apply"
                                     → loadConfig() pulls config.userKeys
                                     → startApplication(config, jobUrl)
                                     → POST /api/start { ..., userKeys: config.userKeys }
```

### Test endpoint per provider

[src/app/api/test-keys/route.ts](../../src/app/api/test-keys/route.ts):

```ts
testAnthropic(key): client.messages.create({ max_tokens: 8, ... "hi" })
testGoogle(key):    POST https://generativelanguage.googleapis.com/.../generateContent
testSteel(key):     GET  https://api.steel.dev/v1/sessions?limit=1 (no creation)
```

Each test:
- Returns `{ ok: true, info }` on success with a short success message (sample text + token count for Anthropic, session count for Steel).
- Returns `{ ok: false, error }` on failure. The route classifies common errors into user-friendly messages: 401/403 → "rejected the key", 429 → "rate-limited but key looks valid".
- Costs effectively $0 (Anthropic: ~$0.0001 for 8 tokens; Steel: $0, list-only; Google: free tier covers).

### Resolution precedence

```text
For any provider's key, the runner uses:
  1. userKeys.<provider> from the request body, if present and non-empty.
  2. process.env.<PROVIDER>_API_KEY (or equivalent), if set.
  3. Otherwise: throw a clear error before the run starts.
```

`/api/start` and `/api/parse-resume` both perform a precheck so the user gets a 400 with the right error message ("Anthropic API key not configured. Add it on the Settings page or set ANTHROPIC_API_KEY on the server.") *before* the runner kicks off.

### Mask + show/hide

```ts
maskKey("sk-ant-api03-abcdef1234567890abcdef") // → "sk-a…cdef"
```

The Settings UI shows the saved key as masked text below the input until the user types something different (then it shows "Save" prominently). A small eye icon in the input toggles to plain text for verification.

## Gotchas

- **localStorage is XSS-vulnerable.** If a malicious script runs on this origin, it can read these keys. We mitigate by never logging keys, never sending them anywhere but our own API, and showing masked values in the UI. Real SaaS auth would store keys server-side with proper encryption.
- **Empty strings are NOT keys.** `keysForRequest` filters them out, and `normalizeKeys` on the server side also drops blanks. So toggling a field off (cleared input → save) properly reverts to env-var fallback.
- **The test endpoint actually calls the provider.** A successful test costs a few hundredths of a cent. Don't spam-test.
- **Anthropic key has dual use.** It drives both the résumé parser (via `/api/parse-resume`) and the field-mapper's custom-question call (via `/api/start`). Setting it on Settings affects both. Same key for both is the right default.
- **Provider key for `provider: "google"`** must be the Gemini key, not Anthropic's. The `/api/start` route refuses to start if `provider: "google"` is selected and neither `userKeys.google` nor `GOOGLE_GENERATIVE_AI_API_KEY` is configured.
- **No key rotation.** If a key leaks, the user clears it from Settings — that's it. There's no "regenerate" flow because we don't issue the keys.
- **Extension vs web app keys are independent.** Updating keys on the web Settings doesn't propagate to the extension. The pairing handshake (which copies the résumé) does NOT copy keys. The user sets keys in both places independently. Acceptable for v1; v2 could include keys in the pairing payload.

## Verification

### Web app

1. Visit `http://localhost:3000` — click the gear icon top-right.
2. Settings page loads at `/settings`.
3. Paste an Anthropic key in the Anthropic row, click **Test**.
4. Green banner: `Reachable. Model returned 8 tokens. Sample: "Hello..."` (or similar).
5. Click **Save**. The input clears to a masked display: `sk-a…XYZ4`.
6. Test with a deliberately wrong key (`sk-ant-INVALID`). Red banner: `anthropic rejected the key. Double-check it.`
7. Repeat for Steel + Google.
8. Click **Forget all keys** — confirmation toast; rows return to empty state.

### End-to-end with user keys

1. Set valid keys on Settings.
2. Drop a résumé on Landing — the parse uses the user's Anthropic key (verify by removing the env var and confirming parse still works).
3. Paste a job URL and click Start — `/api/start` request body has `userKeys: { anthropic, steel }`.
4. Run completes successfully against the user's Steel + Anthropic accounts.

### Extension

1. Build + reload (`cd extension && npm run build` then reload in `chrome://extensions/`).
2. Options page now shows a Keys section with three rows.
3. Test + Save flow identical to web app.
4. Saved keys ride along on every floating-button apply click via `chrome.storage.local`.

### Skipped-required handling

1. Run an application where the résumé doesn't have answers for some required custom questions.
2. When the agent hits `awaiting_review`, the event log pane's footer turns amber:
   ```
   ⚠ 3 required fields need your input
     · Why are you interested in this role?
     · What's your earliest start date?
     · Salary expectations
   Fill these in the live browser, then click Submit for real.
   ```
3. Fix them manually in the embedded iframe, click Submit for real.

## What this enables / doesn't enable

**Enables:**
- Hosted demo where each user brings their own keys → no operator credit burn.
- Self-hosting with operator-provided env vars (unchanged).
- Quick key validation before a real run.

**Doesn't enable:**
- Per-user usage tracking (no auth, no DB).
- Sharing résumé + keys across the web app and the extension automatically.
- Server-side key rotation or revocation.
- Encrypted-at-rest storage (relies on browser localStorage, which is plaintext).

## Failure modes

| Failure | What you see | Mitigation |
|---|---|---|
| Anthropic key wrong on Settings test | Red banner "anthropic rejected the key" | Get a fresh key from console.anthropic.com |
| Anthropic rate-limited during test | Red banner "rate-limited but key looks valid" | Wait, key is valid |
| Steel network error | Red banner with raw message | Check internet connection |
| Gemini key works in test but `/api/start` fails | Stagehand's AI SDK adapter version mismatch | Verify `GEMINI_MODEL` env matches `AVAILABLE_CUA_MODELS` |
| User clears Anthropic, no env fallback | `/api/parse-resume` returns 400 | Set ANTHROPIC_API_KEY in `.env.local` or re-add the key on Settings |
| Localstorage write blocked (private mode) | Save silently no-ops | User re-pastes per session |
