# 02 — Features & Rationale

The demo is intentionally narrow. Three core features carry it; nine common-suspect features were deliberately deferred.

## In scope

### F1 — Résumé parsing (PDF → strict JSON)

**What it does:** User drops a PDF résumé. The server forwards bytes to Anthropic's PDF input API and asks Claude Haiku 4.5 (via `tool_use` with a strict JSON Schema) to extract the résumé into the `Resume` shape: personal info, headline, experience, education, skills, projects, certifications.

**Why we built it:** Without structured JSON, the agent would have to re-read the résumé for every field it fills — slow, expensive, and inconsistent. With it, the agent has a single source of truth it can map deterministically. Also: showing the parsed JSON in the UI is part of the magic moment ("look, it understood my résumé").

**Why this approach (vs PyPDF / local model):** One API call, $0.001 per résumé, strict JSON via tool use, no PDF parsing library to maintain, no GPU dependency.

### F2 — Vision-driven form fill + real submit

**What it does:** Given the parsed résumé + a job URL on Lever / Greenhouse / Ashby, the agent:
1. Spins up a Steel.dev cloud Chromium session
2. Connects Stagehand over CDP
3. Navigates to the job page
4. Calls `stagehand.extract()` once to get the full form schema (labels, types, options)
5. For each field:
   - Tries a **deterministic map** from common labels → résumé JSON fields (name, email, phone, LinkedIn, etc)
   - For EEO/demographic fields, defaults to "Decline to answer"
   - For ambiguous / custom questions, asks Claude to generate an answer grounded in the résumé
6. Uploads the résumé PDF via Playwright's `setInputFiles` (bypasses the LLM)
7. Clicks Submit
8. Captures a post-submit screenshot

**Why we built it:** This is the whole product. Without this, there's no demo.

**Why we chose Lever / Greenhouse / Ashby:** Together they cover roughly half of all postings a candidate sees. They have stable DOM structures, native `<input type="file">` for résumé uploads (Playwright-friendly), and don't gate the actual form behind a CAPTCHA. **Workday is explicitly out** — paginated, bot-detection-heavy, 10+ pages, and a single misbehaving `act()` loop on Workday can burn $5+ in tokens.

### F3 — Live browser stream + agent event log

**What it does:** As soon as the agent starts, the user sees a **split-screen page**:
- **Left (60%)**: the actual Steel.dev cloud browser, embedded in an `<iframe>`. They watch the agent type, click, scroll — in real time.
- **Right (40%)**: a streaming event log narrating every action the agent takes (`▸ Filling First Name`, `↳ alex@example.com`, `✓ Uploading resume.pdf`, `→ Clicking Submit`).
- **Top**: a phase strip — Booting → Reading → Filling → Submitting → Done.

**Why we built it:** This is the demo's hero moment. Anyone who watches it gets the product immediately. Without the live stream it would be just another "fill out a form" tool.

**Why this approach:** Steel.dev's `sessionViewerUrl` is designed to be iframed. Server-Sent Events stream agent events from the Node process to the React UI with no polling. No WebSocket library needed.

## Deliberately deferred

Every one of these was considered and deferred for the demo. They're listed here so future-us doesn't re-litigate them.

| Feature | Why not now |
|---|---|
| Auth / accounts | One user (you). Adds friction to a demo that should be one-click from the landing page. |
| Stripe / payments | No customers to charge yet. The demo is the validator; payments come if/when the demo proves demand. |
| Rate limiting / cost cap | Single user, you're watching the bill. Would add Upstash Redis + per-IP tracking for zero benefit right now. |
| Usage dashboard | We have one user. They are us. |
| PostHog / analytics | No funnel to analyze yet. Vercel Analytics + Sentry can come later. |
| Chrome extension | Worth building when we have users who'd install it. Until then, the paste-URL flow is fine. |
| Application history | All run state lives in-memory by design. If we want history, we want a database — and a database means we're now a SaaS. |
| Cover letter generation | Easy to add (single Claude call) but isn't part of the wow moment. Defer to v2. |
| Workday support | Cost runaway risk + bot detection nightmare + 10+ paginated pages. Hard-blocked at the API layer for the demo. |
| Multi-user / multi-tenancy | One user. See "auth / accounts." |

## Default behaviors worth knowing

- **EEO / demographic questions**: agent always selects "Decline to answer" if that's an available option. Users can opt-in later if we want; for now we err on the side of privacy + faster fills.
- **Required fields with no résumé data**: agent fills via Claude's custom-question fallback (grounded in the résumé). If Claude returns an empty string, the field is skipped — the user will see the unfilled field in the live browser and can decide whether to manually fix or re-run.
- **File upload**: only the résumé PDF. No cover letter file. No transcripts. No portfolio attachments. Adding more would just multiply edge cases without changing the demo.
- **Submit**: real submit. Each run sends a real application. The Confirm screen warns about this with an amber alert; no checkbox gate (would interrupt the demo flow).

## What "done" looks like for each feature

- **F1 done:** any standard PDF résumé returns a `Resume` object that passes Zod validation. Parsed card in the UI shows name, headline, contact info, and at least the most recent role + degree.
- **F2 done:** for a known Lever posting + a real résumé, the agent fills every visible non-file field, uploads the PDF, clicks submit, and captures a post-submit screenshot — without manual intervention. (Greenhouse + Ashby ship after Lever, same bar.)
- **F3 done:** from page-load to "Submitted" confetti, the user has a clear visual story of what the agent is doing. The live iframe is the central element, not a tiny side panel.
