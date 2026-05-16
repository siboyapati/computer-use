/**
 * CORS helper for the API routes the Chrome extension calls.
 *
 * The extension makes requests from `chrome-extension://<id>` origins. Since these
 * endpoints don't carry auth cookies and the demo is single-user, a permissive
 * `Access-Control-Allow-Origin: *` is fine. If we add auth later, replace with
 * an explicit allowlist read from env.
 */

const ALLOW_ORIGIN = "*";
const ALLOW_METHODS = "GET, POST, OPTIONS";
const ALLOW_HEADERS = "Content-Type, Authorization";

export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    "Access-Control-Allow-Methods": ALLOW_METHODS,
    "Access-Control-Allow-Headers": ALLOW_HEADERS,
    "Access-Control-Max-Age": "86400",
  };
}

export function preflightResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export function withCors<T extends Response>(response: T): T {
  const headers = corsHeaders();
  for (const [k, v] of Object.entries(headers)) {
    response.headers.set(k, v);
  }
  return response;
}
