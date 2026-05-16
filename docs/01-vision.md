# 01 — Vision

## The pitch

> **"Apply to fifty jobs in the time it takes to apply to one."**

A job seeker drops their résumé once, then for every interesting posting they either (a) paste the URL into the web app and click Start, or (b) click a floating "Apply with AutoApply" button injected on the job page by the Chrome extension. In both cases, an AI agent opens a cloud browser, reads every form field with vision and the accessibility tree, fills it from the résumé, uploads the PDF, and stops just before submit. The user reviews everything in a live-streamed browser pane, then clicks **Submit for real** to send the application.

End-to-end, one application takes **60–120 seconds** instead of 20–40 minutes.

## Why this exists

Anyone who has applied to >20 jobs has felt the pain: every ATS asks the same 20 fields, takes 20–40 minutes per submission, and the data is already in the résumé that just got uploaded. A motivated candidate ends up either:

1. **Burning hours** on identical data entry across applications.
2. **Skipping applications** for jobs they'd actually take.
3. **Using "spray and pray" tools** (LazyApply, Sonara, Massive) that have poor reputations — they hallucinate answers, get blocked by ATSes, and recruiters can spot them.

The opportunity: **a high-quality, ATS-native, vision-driven agent that fills applications as faithfully as the candidate would themselves**. Powered by Claude's vision + reasoning + accessibility-tree understanding so it handles weird fields, not just templates.

## Why a demo first

The thing that turns this idea into a product isn't the schema or the payment integration — it's whether the demo feels magical when someone watches it. The fastest way to find out is to build the demo, put it in front of people, and see if "where do I sign up?" follows.

Specifically:

- The **wow moment** is watching the agent fill a real form live in the embedded browser. That moment either lands or it doesn't, and you can build it in a couple of weekends.
- Everything else (auth, payments, multi-tenancy, history, analytics) is plumbing that doesn't change whether the wow moment lands. Build it later.
- A demo gets you something concrete to record and share. None of that requires a paywall.

## Why a Chrome extension

The web app's flow is: drop résumé → paste URL → click Start. That's already short, but **the paste-URL step is the friction**. A job seeker reading a Lever posting wants to apply *from that page*, not switch tabs to paste a URL.

The extension closes that gap:

- A floating button appears on every Lever / Greenhouse / Ashby posting.
- One click sends the current tab's URL to the same `/api/start` endpoint that the web app uses.
- A new tab opens with the agent already running.

The extension is a **second client** on top of the same API surface. It doesn't reimplement the agent. The web app remains the source of truth for the parsed résumé (the extension receives a copy via a one-time pairing handshake — see [features/chrome-extension.md](./features/chrome-extension.md)).

## Who this is for

**Right now:** the founder, as a working artifact to show off.

**Soon after:** mid-to-senior knowledge workers in active job-hunt mode (software engineers, designers, PMs), applying to 30+ jobs/month, comfortable with a tool that submits applications after they review.

## What success looks like for the demo

1. **A stranger lands on the URL, drops their résumé, pastes a Lever URL, and a real application gets submitted** — no support, no debugging.
2. **The 60-second screen recording** of an application going through is shareable and looks credible.
3. **At least 5 people who watch it ask "where do I sign up?"** — at which point the SaaS plan kicks in.

## What this deliberately is *not*

- A multi-tenant SaaS (no auth, no payments, no usage tiers).
- A spray-and-pray tool (every submission is a real, candidate-reviewed application by default).
- A general "fill any form on the internet" agent (scoped to 3 ATSes).
- A career-coaching product.

The full deferred list — and why each item is deferred — is in [02 — Features](./02-features.md).
