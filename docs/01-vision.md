# 01 — Vision

## The pitch

> **"Apply to fifty jobs in the time it takes to apply to one."**

A job seeker drops their résumé once, pastes a posting URL, and watches an AI agent fill every field of the real application form, upload the résumé, and click submit — in 60–90 seconds, end to end. They can see the cloud browser working live, embedded in the page, with a streaming event log narrating each step.

## Why this exists

Anyone who has applied to >20 jobs has felt the pain: every application asks the same 20 fields, takes 20–40 minutes per submission, and the data is already in the résumé you just uploaded. A motivated candidate ends up either:

1. **Burning hours** on identical data entry across applications.
2. **Skipping applications** for jobs they'd actually take.
3. **Using "spray and pray" tools** (LazyApply, Sonara, Massive) that have poor reputations — they hallucinate, they get blocked, and recruiters can spot them.

The opportunity: **a high-quality, ATS-native, vision-driven agent that fills applications as faithfully as the candidate would themselves**. Powered by Claude's vision + reasoning so it can handle weird fields, not just template-match.

## Why a demo, not a SaaS, first

The thing that turns this idea into a product isn't the schema or the payment integration. It's whether the demo feels magical when someone watches it. The fastest way to find out is to build the demo and put it in front of people.

Specifically:

- The **wow moment** is watching the agent fill a real form live in the embedded browser. That moment either lands or it doesn't — and you can build it in a couple of weekends.
- Everything else (auth, payments, multi-tenancy, history, analytics) is plumbing that doesn't change whether the wow moment lands. Build it later, once you know the demo works.
- A demo gets you something concrete to record, share, and validate demand with — none of which requires a paywall.

This explicitly contradicts a typical SaaS-first plan. See [02 — Features](./02-features.md) for the full list of things deliberately not in scope.

## Who the demo is for

**Right now:** the founder, as a working artifact to show off.

**Soon after:** mid-to-senior knowledge workers in active job-hunt mode (software engineers, designers, PMs), applying to 30+ jobs/month, comfortable with a tool that submits an application after they review the URL.

## What success looks like (for the demo)

1. **A stranger lands on the URL, drops their résumé, pastes a Lever URL, and a real application gets submitted** — no support, no debugging, no manual intervention from the founder.
2. **The 60-second screen recording** of an application going through is shareable and looks credible.
3. **At least 5 people who watch it ask "where do I sign up?"** — at which point the SaaS plan kicks in.

If those three things happen, the demo did its job. If they don't, we've learned cheaply that the magic moment isn't where we thought it was.

## What this demo deliberately does not try to be

- A multi-tenant SaaS
- A spray-and-pray tool that submits hundreds of applications
- A general "fill any form on the internet" agent (we're scoped to 3 ATSes)
- A career-coaching product
- A LinkedIn alternative

See [02 — Features](./02-features.md) for the full deferred list.
