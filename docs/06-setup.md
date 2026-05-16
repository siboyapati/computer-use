# 06 — Setup & Running

## Prerequisites

- **Node.js 22.x** (Stagehand requires `^20.19 || >=22.12`)
- **npm** (the scaffold and Stagehand both prefer npm; pnpm/yarn untested)
- API keys: at minimum **Anthropic** (always required) and **Steel.dev** (always required). Gemini is optional.

Operating systems: developed on Windows 11. The web app is platform-agnostic and runs the same on macOS and Linux.

## 1. Get API keys

| Service | Where | What you need |
|---|---|---|
| Anthropic | https://console.anthropic.com | Add billing, create an API key (`sk-ant-…`) |
| Steel.dev | https://app.steel.dev | Free tier gives 100 browser-hours/mo. Get an API key (`ste_…`) |
| Google Gemini *(optional)* | https://aistudio.google.com/app/apikey | Free tier for testing |

## 2. Install dependencies

```bash
git clone <this repo>
cd computer-use
npm install
```

This installs everything: Next.js, Stagehand (which pulls Playwright core), Steel SDK, Anthropic SDK, shadcn primitives, Motion, etc.

## 3. Environment

Copy the example and fill it in:

```bash
cp .env.local.example .env.local
```

The minimum required keys for the agent to run:

```
ANTHROPIC_API_KEY=sk-ant-…
STEEL_API_KEY=ste_…
```

If you want the Gemini toggle to work in the UI:

```
GOOGLE_GENERATIVE_AI_API_KEY=…
```

If you don't set the Google key, the toggle still appears but selecting Gemini errors at `/api/start` with a clear message.

## 4. Validate end-to-end with the spike (recommended first run)

The W0 spike script runs Stagehand + Steel against one known Lever posting and stops just before submit. It's the fastest way to verify your keys work and the live browser stream is good.

```bash
npm run spike -- "https://jobs.lever.co/<company>/<job-id>"
```

You'll see:

```text
→ Creating Steel session...
✓ Session abc123…
  Live view: https://app.steel.dev/sessions/abc123…
  ↑ Open that URL in your browser to watch the agent work

→ Navigating to https://jobs.lever.co/…
→ Extracting form fields...
✓ Acme Inc: 12 fields detected
  - First Name (text) *required*
  - Last Name (text) *required*
  - Email (email) *required*
  …

→ Filling a few sample fields (name, email)...

✓ DONE. Form is partially filled — stopping before submit.
  Verify in the live view that fields are populated.
  Sleeping 60s before cleanup so you can inspect...
```

**Open the live view URL in another browser tab** during the run — you should see the cloud Chromium navigating and filling. If you can see the form being filled, the demo is going to work. If you can't see anything, the most likely causes are (a) the Steel API key isn't set, (b) the job URL is wrong, or (c) the Anthropic key has no billing.

Cost for this spike: ~$0.01–$0.05 on Anthropic, ~1 minute of Steel browser-time.

## 5. Run the web app

```bash
npm run dev
```

Opens at http://localhost:3000.

Flow:

1. Drop a PDF résumé on the landing page.
2. Wait 3–7 sec while it parses (you'll see the spinner and "Reading your résumé").
3. Review the parsed card on the Confirm screen, paste a Lever / Greenhouse / Ashby URL, optionally toggle Claude / Gemini.
4. Click **Start applying**.
5. Watch the agent fill the form live, then confetti.

## 6. Build for production

```bash
npm run build
npm start
```

Or deploy directly:

- **Railway** (recommended): connect the GitHub repo, set env vars in the dashboard, push to `main`. Railway gives you long-running Node without function timeouts.
- **Vercel**: works for the static page and short API calls, but `/api/start` triggers a long-running task in the same process. The Hobby plan caps function duration at 60s — applications that take longer than that get killed. **Use Railway, not Vercel, for the agent.**

## Common issues

| Symptom | Likely cause | Fix |
|---|---|---|
| `STEEL_API_KEY is not set` | `.env.local` missing or key empty | Add the key, restart dev server |
| `ANTHROPIC_API_KEY is not set` | Same | Same |
| Steel session created but iframe is blank | Session URL not iframable, or browser blocks third-party iframes | Verify the live URL works in a new tab first |
| Spike script: "Unsupported ATS" | URL hostname doesn't match `*.lever.co`, `*.greenhouse.io`, or `*.ashbyhq.com` | Use a posting from one of those |
| Run gets stuck on "Filling" forever | `act()` retrying invisibly | Check terminal logs; the Stagehand inference logs show what's happening |
| Token budget blown ($5 in one run) | Probably tried a Workday URL or a posting with 50+ fields | The runner doesn't yet hard-block Workday — TODO |

## What's not in this guide

- Anything about auth, payments, dashboards, history, multi-user. The demo doesn't have them. See [02 — Features](./02-features.md) for the deferred list.
- Chrome extension setup. Not built yet. See [02 — Features](./02-features.md) → deferred.
- Native macOS menu bar app. Documented as "good to have" — not built. See [05 — Tech Stack](./05-tech-stack.md) for rationale.
