import { getRun } from "@/lib/agent/events";
import type { AgentEvent } from "@/lib/agent/types";
import { corsHeaders, preflightResponse } from "@/lib/cors";

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
    return new Response(`event: error\ndata: ${JSON.stringify({ error: "Run not found" })}\n\n`, {
      status: 404,
      headers: { "Content-Type": "text/event-stream", ...corsHeaders() },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (kind: string, payload: unknown) => {
        controller.enqueue(encoder.encode(`event: ${kind}\ndata: ${JSON.stringify(payload)}\n\n`));
      };

      // Replay any events the run has already emitted
      for (const event of run.log) send("agent", event);
      send("meta", run.meta);

      const onEvent = (event: AgentEvent) => {
        send("agent", event);
        const latest = getRun(runId);
        if (latest) send("meta", latest.meta);
      };
      const onDone = () => {
        const latest = getRun(runId);
        if (latest) send("meta", latest.meta);
        send("done", { ok: true });
        try {
          controller.close();
        } catch {
          // already closed
        }
        run.emitter.off("event", onEvent);
        run.emitter.off("done", onDone);
      };

      run.emitter.on("event", onEvent);
      run.emitter.on("done", onDone);

      if (run.meta.finishedAt) {
        // The run already completed before this connection — close after replay
        onDone();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      ...corsHeaders(),
    },
  });
}
