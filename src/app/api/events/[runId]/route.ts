import { getRun } from "@/lib/agent/events";
import type { AgentEvent } from "@/lib/agent/types";
import { corsHeaders, preflightResponse } from "@/lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return preflightResponse();
}

/**
 * SSE stream for an in-flight or just-completed run.
 *
 * Protocol:
 *   - On connect: replays the run's existing `log[]` so the client doesn't
 *     miss events that fired before this connection opened.
 *   - Then pipes new events as `event: agent\ndata: {...}` and meta updates
 *     as `event: meta\ndata: {...}`.
 *   - On `finishRun`, emits `event: done` and closes.
 *
 * Cleanup: every attached listener is removed on `cancel()` (browser tab
 * close, EventSource reconnect tear-down, network blip) so the run's
 * EventEmitter doesn't accumulate dead listeners and silently start dropping
 * events at its `setMaxListeners(50)` cap.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const { runId } = await ctx.params;
  const run = getRun(runId);

  if (!run) {
    return new Response(
      `event: error\ndata: ${JSON.stringify({ error: "Run not found" })}\n\n`,
      {
        status: 404,
        headers: { "Content-Type": "text/event-stream", ...corsHeaders() },
      },
    );
  }

  const encoder = new TextEncoder();

  // Listener references hoisted into the closure so `cancel()` can detach
  // them. Without this, multiple EventSource reconnects leak listeners onto
  // `run.emitter` and eventually exceed `setMaxListeners`.
  let onEvent: ((e: AgentEvent) => void) | null = null;
  let onDone: (() => void) | null = null;
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const send = (kind: string, payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${kind}\ndata: ${JSON.stringify(payload)}\n\n`),
          );
        } catch {
          // controller was closed underneath us — treat as cancelled
          closed = true;
        }
      };

      // Snapshot the log length BEFORE attaching listeners. We replay
      // exactly the events that existed at connect time; anything new
      // arrives through the listener. This prevents a race where the
      // emitter fires between `log.push` and our subscription.
      const replayUpTo = run.log.length;
      for (let i = 0; i < replayUpTo; i++) send("agent", run.log[i]);
      send("meta", run.meta);

      onEvent = (event) => {
        send("agent", event);
        const latest = getRun(runId);
        if (latest) send("meta", latest.meta);
      };
      onDone = () => {
        const latest = getRun(runId);
        if (latest) send("meta", latest.meta);
        send("done", { ok: true });
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
        if (onEvent) run.emitter.off("event", onEvent);
        if (onDone) run.emitter.off("done", onDone);
      };

      run.emitter.on("event", onEvent);
      run.emitter.on("done", onDone);

      if (run.meta.finishedAt) {
        // Run already completed before this connection — close after replay.
        onDone();
      }
    },
    cancel() {
      // Browser disconnected (tab close, reload, network blip). Detach
      // listeners so the run's emitter doesn't leak references.
      closed = true;
      if (onEvent) run.emitter.off("event", onEvent);
      if (onDone) run.emitter.off("done", onDone);
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
