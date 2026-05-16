# Environment Variables

All env vars used by the web app and the extension, with whether they're required, where they're read, and what they control.

---

## Web app — `.env.local`

Copy [.env.local.example](../../.env.local.example) → `.env.local` and fill in.

### Required

| Variable | Used for | Where read |
|---|---|---|
| `ANTHROPIC_API_KEY` | Résumé parsing (always) + agent runtime (when provider=anthropic) + custom-question fallback (always) | [src/lib/agent/resume-parser.ts](../../src/lib/agent/resume-parser.ts), [src/lib/agent/field-mapper.ts](../../src/lib/agent/field-mapper.ts), [src/lib/agent/runner.ts](../../src/lib/agent/runner.ts) |
| `STEEL_API_KEY` | Cloud browser provisioning | [src/lib/agent/steel.ts](../../src/lib/agent/steel.ts) |

If either is missing, the relevant code throws on first use. The error bubbles up to the user via toast.

### Optional

| Variable | Default | Used for |
|---|---|---|
| `ANTHROPIC_MODEL_DEFAULT` | `claude-haiku-4-5` | Override the default Anthropic agent model |
| `ANTHROPIC_MODEL_HARD` | `claude-sonnet-4-6` | (Reserved) Escalation model for hard fields — currently not used by runner; documented for future use |
| `GOOGLE_GENERATIVE_AI_API_KEY` | — | Required only if user picks the Gemini agent toggle. Without it, `/api/start` returns 400 if `provider: "google"` |
| `GEMINI_MODEL` | `gemini-3-flash-preview` | Override the Stagehand Gemini model id |
| `STEEL_BASE_URL` | (Steel default) | Override Steel API base (unlikely to need) |

### Read at module load (server-only)

```ts
process.env.ANTHROPIC_API_KEY             // anthropic client
process.env.STEEL_API_KEY                 // steel client
process.env.ANTHROPIC_MODEL_DEFAULT       // resolveStagehandModel + field-mapper
process.env.GOOGLE_GENERATIVE_AI_API_KEY  // resolveStagehandModel (Gemini branch)
process.env.GEMINI_MODEL                  // resolveStagehandModel (Gemini branch)
```

**Never read client-side.** Display-only metadata for the model toggle is hardcoded in `MODEL_CHOICES` ([src/lib/agent/types.ts](../../src/lib/agent/types.ts)) to keep the file client-safe.

### Where to get the keys

- **Anthropic** — <https://console.anthropic.com> → API Keys. Enable billing (free trial credits exhaust quickly).
- **Steel.dev** — <https://app.steel.dev> → API Keys. Free tier = 100 browser-hours/mo.
- **Google Gemini** — <https://aistudio.google.com/app/apikey>. Free tier for testing.

---

## Extension — `.env.development` / `.env.production`

Plasmo exposes any var prefixed with `PLASMO_PUBLIC_` to the bundled extension code as `process.env.PLASMO_PUBLIC_*`.

### Files

```
extension/
├── .env.example          # template
├── .env.development      # used by `plasmo dev`
└── .env.production       # used by `plasmo build`
```

### Variables

| Variable | Default | Used for |
|---|---|---|
| `PLASMO_PUBLIC_API_BASE` | `http://localhost:3000` | The web app URL the extension calls (`/api/start`, `/connect`, deep-link target) |

Where read: [extension/src/options.tsx](../../extension/src/options.tsx). Bundled into the extension as a string at build time — changing it requires a rebuild.

For production:

```text
# extension/.env.production
PLASMO_PUBLIC_API_BASE=https://your-railway-url.up.railway.app
```

Then rebuild (`npm run build` in `extension/`) and reload the extension in `chrome://extensions/`.

### Manifest fields that need to match the env

The web app URL must also appear in two places in `extension/package.json` `manifest`:

```jsonc
{
  "host_permissions": [
    "https://*.lever.co/*",
    ...,
    "http://localhost:3000/*",                            // ← dev API base
    "https://your-railway-url.up.railway.app/*"           // ← prod API base
  ],
  "externally_connectable": {
    "matches": [
      "http://localhost:3000/*",
      "http://127.0.0.1:3000/*",
      "https://autoapply.com/*"                           // ← replace with your prod URL
    ]
  }
}
```

If `externally_connectable.matches` doesn't include the web app's origin, the `/connect` page can't message the extension and pairing silently fails.

---

## CI / production

For a Railway deploy, set the same vars in the Railway dashboard:

- `ANTHROPIC_API_KEY`
- `STEEL_API_KEY`
- (optional) `GOOGLE_GENERATIVE_AI_API_KEY`

Railway auto-loads them at runtime. No `.env.production` needed for the web app.

---

## Security

- All keys are server-side. **Never expose `ANTHROPIC_API_KEY` or `STEEL_API_KEY` to the client** (no `NEXT_PUBLIC_` prefix on these).
- The Plasmo `PLASMO_PUBLIC_*` keys are bundled into the extension and visible to anyone who installs it. Only put public-facing URLs there.
- The extension currently doesn't authenticate to `/api/start` — anyone with the API URL can hit it. Acceptable for single-user demo; add `Authorization: Bearer <token>` tied to the pairing handshake if you publish to the Chrome Web Store.

---

## Quick sanity check

```bash
# In the web app root
cat .env.local | grep -v ^# | grep -v ^$

# Should print:
ANTHROPIC_API_KEY=sk-ant-...
STEEL_API_KEY=ste_...
# (optional)
GOOGLE_GENERATIVE_AI_API_KEY=...
```

```bash
# In extension/
cat .env.development
# Should print:
PLASMO_PUBLIC_API_BASE=http://localhost:3000
```
