# AutoApply

AutoApply is a vision-driven AI job application agent.

It helps you:

- Parse a resume PDF into structured profile data.
- Open a live cloud browser session on a supported ATS posting.
- Fill job application fields with deterministic mapping plus model fallback.
- Pause for review before submit (default), then submit on demand.
- Trigger runs from either the web app or the Chrome extension.

Supported ATS:

- Lever (`jobs.lever.co`)
- Greenhouse (`job-boards.greenhouse.io`)
- Ashby (`jobs.ashbyhq.com`)

## Repository layout

- `src/` - Next.js web app (UI + API routes + runner)
- `extension/` - Plasmo Chrome extension
- `docs/` - product, architecture, feature deep-dives, and references

Start at [docs/README.md](./docs/README.md) for full project documentation.

## Tech stack

- Next.js 16, React 19, TypeScript
- Tailwind CSS v4 + shadcn/ui
- Stagehand v3 + Steel.dev browser sessions
- Anthropic (default) or Gemini (toggle)

## Quick start

### 1. Install dependencies

```bash
npm install
```

```bash
cd extension
npm install
cd ..
```

### 2. Configure environment

Create `.env.local` in the repo root (or copy from `.env.local.example`) and set:

```env
ANTHROPIC_API_KEY=sk-ant-...
STEEL_API_KEY=ste_...
# Optional: only needed when selecting Gemini provider
GOOGLE_GENERATIVE_AI_API_KEY=...
```

See [docs/reference/env.md](./docs/reference/env.md) for all variables.

### 3. Run the web app

```bash
npm run dev
```

Open <http://localhost:3000>.

### 4. Build the extension

```bash
cd extension
npm run build
```

Load unpacked from `extension/build/chrome-mv3-prod/` via `chrome://extensions`.

## Common scripts

- `npm run dev` - start Next.js dev server
- `npm run build` - production build
- `npm run start` - run production build
- `npm run lint` - lint workspace
- `npm run test:semantic` - semantic matching test script
- `npm run spike -- "<job-url>"` - key/path smoke test against a live ATS URL

## API overview

Main endpoints:

- `POST /api/parse-resume`
- `POST /api/start`
- `GET /api/events/[runId]` (SSE)
- `GET /api/runs/[runId]`
- `POST /api/stop/[runId]`
- `POST /api/submit-now/[runId]`
- `POST /api/test-keys`

Detailed contracts: [docs/reference/api.md](./docs/reference/api.md)

## Deployment

Deploy the web app as a long-running Node service (for example Railway). This project is not optimized for short-lived serverless limits on long ATS runs.

After deployment:

- Set production env vars on the server.
- Point `extension/.env.production` to your deployed API base.
- Rebuild and reload the extension.

Detailed setup and deployment steps: [docs/06-setup.md](./docs/06-setup.md)
