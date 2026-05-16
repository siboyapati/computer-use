import { NextResponse } from "next/server";
import { getRun } from "@/lib/agent/events";
import { preflightResponse, withCors } from "@/lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return preflightResponse();
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const { runId } = await ctx.params;
  const run = getRun(runId);
  if (!run) {
    return withCors(NextResponse.json({ error: "Run not found" }, { status: 404 }));
  }
  return withCors(NextResponse.json({ meta: run.meta, eventCount: run.log.length }));
}
