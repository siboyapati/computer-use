import type { ATS, PairedConfig } from "./types";

export interface StartResponse {
  runId: string;
  liveUrl: string | null;
  ats: ATS;
}

export async function startApplication(
  config: PairedConfig,
  jobUrl: string,
): Promise<StartResponse> {
  const res = await fetch(`${config.apiBase}/api/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      resume: config.resume,
      pdfBase64: config.pdfBase64,
      jobUrl,
      provider: "anthropic",
      reviewMode: true,
      // If the user configured keys in the extension's Settings, send
      // them along. Server uses them in-flight, doesn't persist.
      userKeys: config.userKeys,
      profile: config.profile,
    }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body.error ?? "";
    } catch {
      // ignore
    }
    throw new Error(detail || `Server returned ${res.status}`);
  }
  return (await res.json()) as StartResponse;
}

/**
 * Hit the server's /api/test-keys endpoint to validate a single key.
 * Lives in the extension so the Settings UI doesn't have to know the
 * fetch shape.
 */
export async function testKey(
  apiBase: string,
  provider: "anthropic" | "google" | "steel",
  key: string,
): Promise<{ ok: boolean; info?: string; error?: string }> {
  const res = await fetch(`${apiBase.replace(/\/+$/, "")}/api/test-keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, key }),
  });
  return (await res.json()) as { ok: boolean; info?: string; error?: string };
}

export function liveRunUrl(apiBase: string, runId: string): string {
  return `${apiBase.replace(/\/+$/, "")}/?runId=${encodeURIComponent(runId)}`;
}

export function connectUrl(apiBase: string, extId: string): string {
  return `${apiBase.replace(/\/+$/, "")}/connect?ext_id=${encodeURIComponent(extId)}`;
}
