/**
 * Resolve API keys per-request.
 *
 * The web app and the Chrome extension can ship user-provided keys with
 * each `/api/start` (and `/api/parse-resume`) call. When a key is present
 * in the request payload, we use it; otherwise we fall back to the server's
 * env vars. This lets a hosted demo work for the operator out of the box
 * AND let individual users bring their own keys so they aren't burning
 * the operator's credits.
 *
 * Security notes:
 *   - The server NEVER persists user-provided keys. They live for the
 *     duration of one request handler invocation.
 *   - Keys never enter `log[]` or `meta.error`. The runner emits redacted
 *     strings (see `redact()` in runner.ts) — keys aren't a known PII
 *     pattern in the field-fill values, so they shouldn't leak there
 *     either, but be careful never to log them on the agent path.
 *   - Each provider-specific call uses the matching user key when present
 *     and falls back to the matching env var only when omitted.
 */

/** Shape accepted by API routes for per-request key overrides. */
export interface UserKeys {
  anthropic?: string;
  google?: string;
  steel?: string;
}

/**
 * Strip empty / whitespace-only strings so a present-but-empty form field
 * doesn't shadow an env var.
 */
export function normalizeKeys(input: unknown): UserKeys {
  if (!input || typeof input !== "object") return {};
  const raw = input as Record<string, unknown>;
  const trim = (v: unknown): string | undefined => {
    if (typeof v !== "string") return undefined;
    const t = v.trim();
    return t.length > 0 ? t : undefined;
  };
  return {
    anthropic: trim(raw.anthropic),
    google: trim(raw.google),
    steel: trim(raw.steel),
  };
}

/**
 * Resolve the Anthropic API key for this request.
 * Throws if neither user override nor `ANTHROPIC_API_KEY` env var is set.
 */
export function resolveAnthropic(userKeys?: UserKeys): string {
  const keys = normalizeKeys(userKeys);
  const k = keys.anthropic ?? process.env.ANTHROPIC_API_KEY;
  if (!k) {
    throw new Error(
      "Anthropic API key not configured. Add it on the Settings page or set ANTHROPIC_API_KEY on the server.",
    );
  }
  return k;
}

/** Resolve the Steel API key. */
export function resolveSteel(userKeys?: UserKeys): string {
  const keys = normalizeKeys(userKeys);
  const k = keys.steel ?? process.env.STEEL_API_KEY;
  if (!k) {
    throw new Error(
      "Steel API key not configured. Add it on the Settings page or set STEEL_API_KEY on the server.",
    );
  }
  return k;
}

/** Resolve the Google Gemini API key — optional unless provider === "google". */
export function resolveGoogle(userKeys?: UserKeys): string | undefined {
  const keys = normalizeKeys(userKeys);
  return keys.google ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
}
