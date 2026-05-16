/**
 * POST /api/fill/[runId]
 *
 * Queue a single inline fill instruction for a run that's paused in
 * `awaiting_review`. The runner's `waitForSubmitOrStop()` drains this
 * queue every ~250 ms and executes each entry via `stagehand.act()`,
 * emitting a `field_filled` event when done.
 *
 * Used by the LiveRun footer's "Save & fill" button next to each
 * required field the agent skipped — lets the user dictate the answer
 * once and have it both (a) appear in the live browser via the running
 * agent and (b) persist to their profile for next time.
 *
 * Body:
 *   { label: string, value: string }
 *
 * Returns:
 *   200 { ok: true }   — queued (will be picked up within ~250 ms)
 *   400 { error }      — invalid body
 *   404 { error }      — run not found
 */

import { NextResponse } from "next/server";
import { requestFill } from "@/lib/agent/events";
import { preflightResponse, withCors } from "@/lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return preflightResponse();
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const { runId } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return withCors(NextResponse.json({ error: "Invalid JSON" }, { status: 400 }));
  }
  if (!body || typeof body !== "object") {
    return withCors(NextResponse.json({ error: "Body must be an object" }, { status: 400 }));
  }
  const { label, value } = body as { label?: unknown; value?: unknown };
  if (typeof label !== "string" || !label.trim()) {
    return withCors(NextResponse.json({ error: "Missing label" }, { status: 400 }));
  }
  if (typeof value !== "string" || !value.trim()) {
    return withCors(NextResponse.json({ error: "Missing value" }, { status: 400 }));
  }
  const ok = requestFill(runId, label, value);
  if (!ok) {
    return withCors(NextResponse.json({ error: "Run not found" }, { status: 404 }));
  }
  return withCors(NextResponse.json({ ok: true }));
}
