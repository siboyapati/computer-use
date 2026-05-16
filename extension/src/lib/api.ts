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

export function liveRunUrl(apiBase: string, runId: string): string {
  return `${apiBase.replace(/\/+$/, "")}/?runId=${encodeURIComponent(runId)}`;
}

export function connectUrl(apiBase: string, extId: string): string {
  return `${apiBase.replace(/\/+$/, "")}/connect?ext_id=${encodeURIComponent(extId)}`;
}
