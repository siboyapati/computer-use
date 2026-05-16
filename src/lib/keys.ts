"use client";

/**
 * Browser-side storage for user-provided API keys.
 *
 * Persisted to localStorage under `autoapply.keys.v1`. Sent with every
 * `/api/start` and `/api/parse-resume` call so the server uses these keys
 * instead of its own env vars. The server never persists them.
 *
 * Trade-off: localStorage is XSS-vulnerable. If a malicious script ends up
 * running on this origin, it can read these keys. We mitigate by:
 *   - Showing only the first/last 4 chars in the Settings UI.
 *   - Documenting the risk in the Settings page copy.
 *   - Never logging the keys, never sending them anywhere but our own API.
 *
 * Real SaaS auth would store these server-side per user. For a
 * single-user demo, localStorage is the right trade-off.
 */

const KEY = "autoapply.keys.v1";

export interface StoredKeys {
  anthropic?: string;
  google?: string;
  steel?: string;
  updatedAt?: number;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadKeys(): StoredKeys {
  if (!isBrowser()) return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredKeys;
    return {
      anthropic: parsed.anthropic?.trim() || undefined,
      google: parsed.google?.trim() || undefined,
      steel: parsed.steel?.trim() || undefined,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return {};
  }
}

export function saveKeys(keys: StoredKeys): void {
  if (!isBrowser()) return;
  try {
    // Normalize: drop blank strings, keep only non-empty trimmed values.
    const normalized: StoredKeys = {
      anthropic: keys.anthropic?.trim() || undefined,
      google: keys.google?.trim() || undefined,
      steel: keys.steel?.trim() || undefined,
      updatedAt: Date.now(),
    };
    window.localStorage.setItem(KEY, JSON.stringify(normalized));
  } catch {
    // QuotaExceededError or JSON error — silently skip
  }
}

export function clearKeys(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** Mask a key for display: show first 4 + last 4, hyphens in between. */
export function maskKey(key: string | undefined): string {
  if (!key) return "—";
  const trimmed = key.trim();
  if (trimmed.length <= 10) return "•".repeat(trimmed.length);
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

/**
 * Strip the `updatedAt` timestamp so the resulting object matches the
 * `userKeys` shape that the server expects.
 */
export function keysForRequest(stored: StoredKeys): {
  anthropic?: string;
  google?: string;
  steel?: string;
} | undefined {
  const cleaned: { anthropic?: string; google?: string; steel?: string } = {};
  if (stored.anthropic) cleaned.anthropic = stored.anthropic;
  if (stored.google) cleaned.google = stored.google;
  if (stored.steel) cleaned.steel = stored.steel;
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}
