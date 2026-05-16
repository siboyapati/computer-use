# Feature — Model Toggle (Claude / Gemini)

## What

A toggle on the Confirm screen lets the user pick which LLM drives the agent for a given run:

- **Claude Haiku 4.5** (`anthropic/claude-haiku-4-5`) — default.
- **Gemini 3 Flash** (`google/gemini-3-flash-preview`) — opt-in if `GOOGLE_GENERATIVE_AI_API_KEY` is set.

The choice is per-run, sent as part of the `/api/start` payload. Both models drive Stagehand's `extract`/`act` calls. The résumé parser **always** stays on Anthropic (PDF input + tool use is best supported there).

## Why

Three reasons:

1. **Model-agnostic positioning.** The product is the agent, not the model. Showing both options live during a demo makes it visceral.
2. **A/B without rewriting.** Founder can compare quality + cost on the same job posting with different providers in two clicks.
3. **Resilience.** If Anthropic is rate-limited or down, Gemini is one toggle away. Stagehand's AI SDK adapter handles the provider switch transparently.

We did *not* default to "always use both and pick the best" because:

- Doubles cost.
- Doubles latency.
- The user wants to *choose*, not see a vote.

We did *not* offer OpenAI / GPT because:

- Stagehand v3's primary integrations are Anthropic + Google; adding a third widens the surface without a clear win.
- The web app's résumé parser depends on Anthropic PDF input regardless.

## How

### Files

- [src/lib/agent/types.ts](../../src/lib/agent/types.ts) — `LLMProvider` type + `MODEL_CHOICES` UI metadata.
- [src/lib/agent/runner.ts](../../src/lib/agent/runner.ts) — `resolveStagehandModel(provider)` returns `{ modelName, apiKey }`.
- [src/app/api/start/route.ts](../../src/app/api/start/route.ts) — accepts `provider` in the start body; pre-checks the Google key.
- [src/components/confirm.tsx](../../src/components/confirm.tsx) — the toggle UI.
- [src/lib/client-types.ts](../../src/lib/client-types.ts) — `AppState.provider` flows through the reducer.

### Types

```ts
export type LLMProvider = "anthropic" | "google";

export const MODEL_CHOICES: Record<LLMProvider, ModelChoice> = {
  anthropic: {
    provider: "anthropic",
    label: "Claude Haiku 4.5",
    shortLabel: "Claude",
    modelId: "claude-haiku-4-5",
  },
  google: {
    provider: "google",
    label: "Gemini 3 Flash",
    shortLabel: "Gemini",
    modelId: "gemini-3-flash-preview",
  },
};
```

`MODEL_CHOICES` is **client-safe** (no env reads). Actual model IDs are resolved server-side via env vars.

### Server-side resolution

```ts
function resolveStagehandModel(provider: LLMProvider): { modelName: string; apiKey: string } {
  if (provider === "google") {
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set — cannot use the Gemini agent");
    const model = process.env.GEMINI_MODEL || "gemini-3-flash-preview";
    return { modelName: `google/${model}`, apiKey };
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const model = process.env.ANTHROPIC_MODEL_DEFAULT || "claude-haiku-4-5";
  return { modelName: `anthropic/${model}`, apiKey };
}
```

The `modelName` format is Stagehand's convention: `${provider}/${model}`. Stagehand's AI SDK adapter routes from there to the appropriate provider library.

### `/api/start` pre-check

To fail fast with a clear error (rather than mid-run), the start route checks the Google key before kicking off the runner:

```ts
if (provider === "google" && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  return withCors(NextResponse.json(
    { error: "Gemini agent isn't configured — set GOOGLE_GENERATIVE_AI_API_KEY in .env.local" },
    { status: 400 },
  ));
}
```

The toast on the Confirm screen surfaces this message verbatim — clear feedback without digging into network logs.

### UI toggle

[confirm.tsx](../../src/components/confirm.tsx) `ModelToggle`:

```tsx
<div className="inline-flex items-center gap-1 rounded-full border border-border bg-card/60 p-0.5">
  {(["anthropic", "google"] as const).map((p) => {
    const c = MODEL_CHOICES[p];
    const active = p === provider;
    return (
      <button key={p} onClick={() => onChange(p)}
        className={cn("rounded-full px-3 py-1", active ? "text-primary-foreground" : "text-muted-foreground")}>
        {active && (
          <motion.span layoutId="model-toggle-pill" className="absolute inset-0 rounded-full bg-primary" />
        )}
        <span className="relative">{c.shortLabel}</span>
      </button>
    );
  })}
</div>
```

The animated pill uses Motion's `layoutId` to slide between the two options with a spring. Visually it's a clear modal switch, not a checkbox.

### Where it flows

```text
Confirm screen: provider state (default "anthropic")
   ↓ click toggle → setProvider("google")
   ↓ click Start
POST /api/start { ..., provider }
   → server: validate, check key, run resolveStagehandModel(provider)
   → new Stagehand({ model: { modelName, apiKey } })
```

The provider is **not** persisted to localStorage — it's a per-run choice. We *do* persist the last-used provider in the reducer state so a back-and-forth between Confirm and Landing doesn't reset it, but a hard refresh starts fresh on Anthropic.

## Gotchas

- **Résumé parsing is always Claude.** Even with the toggle on Gemini, `/api/parse-resume` uses Anthropic PDF input. The toggle controls the **agent**, not the parser. We considered making this configurable but PDF tool-use is sufficiently Anthropic-specific to keep it pinned.
- **Field-mapper custom-question Claude call is *also* always Anthropic.** This is a wart — strictly speaking, picking Gemini means the agent uses Gemini for Stagehand `act`/`extract`, but custom-question answers still come from Claude. We could fix this with a provider switch in `answerCustomQuestion`, but for the demo this is acceptable (both surfaces are LLM-driven; switching one is the more interesting demo).
- **No persistence across runs.** Toggle resets to Claude on full refresh. We could persist if users start asking for it.
- **Gemini quality on form fill.** In our spike testing, Gemini 3 Flash matched Haiku 4.5 on simple forms but was slightly less consistent on Ashby's class-hashed SPA. Both work; Haiku is the documented default.
- **Cost difference at this scale is negligible.** Both models are pennies per run. Don't over-optimize.

## Verification

### Anthropic path (default)

1. Drop résumé, paste a Lever URL.
2. Confirm screen — toggle defaults to "Claude" with the animated pill on the left.
3. Click Start. In the event log, the first "started" event includes `data.modelName: "anthropic/claude-haiku-4-5"`.
4. Run completes normally.

### Gemini path

1. Ensure `GOOGLE_GENERATIVE_AI_API_KEY` is set in `.env.local`. Restart dev server.
2. Drop résumé, paste a Lever URL.
3. Click the toggle to "Gemini" — pill slides right.
4. Click Start. Event log shows `data.modelName: "google/gemini-3-flash-preview"`.
5. Run completes normally with Gemini-driven extract / act calls.

### Missing key path

1. Remove `GOOGLE_GENERATIVE_AI_API_KEY` from `.env.local`. Restart dev server.
2. On Confirm, click Gemini toggle. Click Start.
3. Toast appears: "Gemini agent isn't configured — set GOOGLE_GENERATIVE_AI_API_KEY in .env.local".
4. No run started.

## Failure modes

| Failure | What you see | Mitigation |
|---|---|---|
| Google key missing | 400 toast immediately on Start | Add the key or switch to Claude |
| Gemini rate-limited | Run fails mid-fill with provider error | Retry with Claude |
| Stagehand AI SDK adapter mismatch | Stagehand throws "Unknown model provider" | Verify `GEMINI_MODEL` env var matches one of Stagehand's `AVAILABLE_CUA_MODELS` |
| Toggle UI desync | Animated pill stuck on wrong side | Bug in Motion's `layoutId` deduping — refresh; not seen in practice |
