# 06 — Setup & Running

End-to-end setup for the web app and the Chrome extension. If you're new, run the steps in order. If you're already set up, jump to [common issues](#common-issues).

## Prerequisites

- **Node.js 22.x** (Stagehand requires `^20.19 || >=22.12`).
- **npm** in both `./` and `./extension/`.
- **Chrome / Chromium** (Edge, Brave, Arc all work) — required for the extension.
- API keys:
  - **Anthropic** — always required. Get from <https://console.anthropic.com> (billing enabled).
  - **Steel.dev** — always required. Get from <https://app.steel.dev> (free tier: 100 browser-hours/mo).
  - **Google Gemini** — optional, only if you want the Gemini toggle. Get from <https://aistudio.google.com/app/apikey>.

Developed on Windows 11. The web app and extension build the same on macOS / Linux.

---

## 1 · Clone and install the web app

```bash
git clone <this repo>
cd computer-use
npm install
```

This pulls Next.js, Stagehand (with its Playwright core peer dep), Steel SDK, Anthropic SDK, shadcn primitives, Motion, etc.

## 2 · Configure environment

Copy the example file and fill it in:

```bash
cp .env.local.example .env.local
```

Minimum required:

```text
ANTHROPIC_API_KEY=sk-ant-...
STEEL_API_KEY=ste_...
```

Optional (Gemini toggle):

```text
GOOGLE_GENERATIVE_AI_API_KEY=...
```

Without the Google key, the Confirm screen still shows the Gemini toggle but `/api/start` returns a 400 with a clear message if you pick Gemini.

For the full list and defaults, see [reference/env.md](./reference/env.md).

## 3 · Run the W0 spike (recommended first run)

The spike script verifies your keys work and the live browser stream lands, without touching the UI.

```bash
npm run spike -- "https://jobs.lever.co/<company>/<job-id>"
```

What you'll see:

```text
→ Creating Steel session...
✓ Session abc123…
  Live view: https://app.steel.dev/sessions/abc123…
  ↑ Open that URL in your browser tab to watch the agent work

→ Navigating to https://jobs.lever.co/...
→ Extracting form fields...
✓ Acme Inc: 12 fields detected
  - First Name (text) *required*
  - Last Name (text) *required*
  - Email (email) *required*
  ...

→ Filling a few sample fields (name, email)...

✓ DONE. Form is partially filled — stopping before submit.
  Verify in the live view that fields are populated.
  Sleeping 60s before cleanup so you can inspect...
```

Cost: ~$0.01–$0.05 on Anthropic, ~1 minute of Steel browser-time. The script does not submit — it stops before the Submit click so you can re-run safely.

**Open the live-view URL in a browser tab during the run** — if you see the cloud Chromium filling the form, your demo is going to work.

## 4 · Run the web app

```bash
npm run dev
```

Opens at <http://localhost:3000>.

Flow:

1. Drop a PDF résumé (≤5 MB).
2. Wait 3–7 seconds for parsing.
3. Review the parsed card on Confirm. Paste a real Lever / Greenhouse / Ashby URL.
4. **Review-before-submit is ON by default** — agent will fill, upload, then pause.
5. Click **Start applying**.
6. Watch the agent fill the form live in the embedded iframe.
7. When status flips to *Awaiting review*, click **Submit for real** in the header.
8. Confetti + screenshot modal.

---

## 5 · Build and load the Chrome extension

```bash
cd extension
npm install
npm run build
```

Output goes to `extension/build/chrome-mv3-prod/`.

To load it:

1. Open `chrome://extensions/`.
2. Toggle **Developer mode** (top-right).
3. Click **Load unpacked** → pick `extension/build/chrome-mv3-prod/`.
4. The options page opens automatically on first install.

If you want hot-reload during development:

```bash
npm run dev
```

This writes to `extension/build/chrome-mv3-dev/`. Reload from `chrome://extensions/` after each rebuild (or click the refresh icon on the extension card).

## 6 · Pair the extension with the web app

1. Make sure the web app is running at <http://localhost:3000>.
2. On the web app, drop your résumé (one time).
3. Open the extension's options page (`chrome://extensions/` → AutoApply → **Details** → **Extension options**).
4. Click **Connect to AutoApply**. A new tab opens to `/connect?ext_id=<id>`.
5. Click **Allow + Pair**. You should see "✓ Paired" and the options page now shows your résumé summary.
6. Visit any Lever / Greenhouse / Ashby job posting. A floating glass button appears bottom-right.
7. Click → a new tab opens at `localhost:3000/?runId=<id>` showing the agent already running.

---

## 7 · Deploy

The web app builds to a single Node process. **Deploy to Railway**, not Vercel, because some real ATS fills take longer than Vercel's 300 s function cap.

```bash
# Link the repo to Railway via the web UI, set env vars, push.
git push origin main
```

After deploy:

- Update the extension's `extension/.env.production` with `PLASMO_PUBLIC_API_BASE=https://your-railway-url.up.railway.app`.
- Add the production URL to `manifest.externally_connectable.matches` in `extension/package.json` (already includes `autoapply.com/*` as a placeholder — replace with your real URL).
- Rebuild: `npm run build` and re-load the extension.

The extension will work cross-machine pointing at the deployed URL.

---

## Common issues

| Symptom | Cause | Fix |
|---|---|---|
| `STEEL_API_KEY is not set` | `.env.local` missing or empty | Add the key and restart `npm run dev` |
| `ANTHROPIC_API_KEY is not set` | Same | Same |
| Steel session created but iframe is blank | Session URL not iframable in your browser or third-party iframes blocked | Open the live URL in a separate tab first to confirm; check `X-Frame-Options` |
| Spike script: "Unsupported ATS" | URL hostname doesn't match `*.lever.co`, `*.greenhouse.io`, or `*.ashbyhq.com` | Use a posting from one of those |
| Run gets stuck on "Filling" forever | `act()` retrying invisibly (verbose logs are disabled) | Re-run with `verbose: 2` in `runner.ts` temporarily; check Stagehand's inference logs |
| Token budget blown | Probably a Workday URL slipped through, or a posting with 50+ fields | `detectATS` should hard-block Workday; check the URL. Per-run cap of 40 fields protects most cases |
| Extension options page is blank / errors | Plasmo dev build out of sync | `npm run build` in `extension/`, then reload from `chrome://extensions/` |
| `chrome.runtime.sendMessage` fails on `/connect` | `externally_connectable.matches` doesn't include your origin | Check `extension/package.json` includes your dev origin (e.g. `http://localhost:3000/*`) |
| Floating button doesn't appear on a Lever page | Either not paired, or URL has no posting path | Check options page shows "Connected"; verify URL has at least 2 path segments after the host |
| Deep link `/?runId=X` shows landing screen | `runId` not in the in-memory map (process restarted, or run finished + pruned) | Just start a new run — runs persist in-memory for 30 min after they finish |

---

## What's *not* in this guide

- **Stripe / payments setup** — not in scope (single-user demo).
- **Auth setup** — not in scope.
- **Production observability** — Sentry / PostHog deliberately omitted; see [02 — Features](./02-features.md#deferred-considered-not-built).
- **Chrome Web Store submission** — would happen after the extension is paired with a deployed production URL and a privacy policy page is published. Out of scope for this build.

For deeper dives on any specific surface, see [`features/`](./features/).
