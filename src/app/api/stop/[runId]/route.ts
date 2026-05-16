import { NextResponse } from "next/server";
import { requestStop } from "@/lib/agent/events";
import { preflightResponse, withCors } from "@/lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CORS preflight — required so the Chrome extension can POST from
// `chrome-extension://<id>`, which is a non-same-origin caller.
export async function OPTIONS() {
  return preflightResponse();
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const { runId } = await ctx.params;
  const ok = requestStop(runId);
  if (!ok) {
    return withCors(NextResponse.json({ error: "Run not found" }, { status: 404 }));
  }
  return withCors(NextResponse.json({ ok: true }));
}
