import Steel from "steel-sdk";

let client: Steel | null = null;

function getClient(): Steel {
  if (!client) {
    const apiKey = process.env.STEEL_API_KEY;
    if (!apiKey) throw new Error("STEEL_API_KEY is not set");
    client = new Steel({ steelAPIKey: apiKey });
  }
  return client;
}

export interface SteelSessionInfo {
  id: string;
  websocketUrl: string;
  sessionViewerUrl: string;
  debugUrl: string;
}

export async function createSession(): Promise<SteelSessionInfo> {
  const session = await getClient().sessions.create({
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

export async function releaseSession(id: string): Promise<void> {
  try {
    await getClient().sessions.release(id);
  } catch {
    // best-effort
  }
}
