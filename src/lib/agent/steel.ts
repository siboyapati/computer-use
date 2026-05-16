import Steel from "steel-sdk";

/**
 * Thin wrapper around the Steel SDK.
 *
 * Each call accepts an optional `apiKey` so the runner can pass through a
 * user-provided key. If omitted, falls back to `process.env.STEEL_API_KEY`.
 *
 * We construct a fresh client per call when a custom key is provided
 * (don't reuse the cached default client). The SDK is cheap to instantiate.
 */

let defaultClient: Steel | null = null;

function getDefaultClient(): Steel {
  if (!defaultClient) {
    const apiKey = process.env.STEEL_API_KEY;
    if (!apiKey) throw new Error("STEEL_API_KEY is not set");
    defaultClient = new Steel({ steelAPIKey: apiKey });
  }
  return defaultClient;
}

function clientFor(apiKey?: string): Steel {
  if (apiKey) return new Steel({ steelAPIKey: apiKey });
  return getDefaultClient();
}

export interface SteelSessionInfo {
  id: string;
  websocketUrl: string;
  sessionViewerUrl: string;
  debugUrl: string;
}

export async function createSession(apiKey?: string): Promise<SteelSessionInfo> {
  const session = await clientFor(apiKey).sessions.create({
    stealthConfig: {
      humanizeInteractions: true,
      autoCaptchaSolving: false,
    },
    timeout: 1000 * 60 * 10,
    dimensions: { width: 1440, height: 900 },
    blockAds: true,
  });
  return {
    id: session.id,
    websocketUrl: session.websocketUrl,
    sessionViewerUrl: session.sessionViewerUrl,
    debugUrl: session.debugUrl,
  };
}

export async function releaseSession(id: string, apiKey?: string): Promise<void> {
  try {
    await clientFor(apiKey).sessions.release(id);
  } catch {
    // best-effort
  }
}
