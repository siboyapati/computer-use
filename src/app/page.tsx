"use client";

import { useEffect, useReducer, useRef } from "react";
import { AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { Landing } from "@/components/landing";
import { Confirm } from "@/components/confirm";
import { LiveRun } from "@/components/live-run";
import { INITIAL_STATE, type AppState } from "@/lib/client-types";
import { ResumeSchema, type AgentEvent, type LLMProvider, type RunMetadata, type ATS } from "@/lib/agent/types";

type Action =
  | { type: "PARSED"; resume: AppState["resume"]; pdfBase64: string; fileName: string }
  | { type: "BACK_TO_LANDING" }
  | { type: "START_PENDING" }
  | { type: "STARTED"; runId: string; liveUrl: string | null; ats: ATS }
  | { type: "EVENT"; event: AgentEvent }
  | { type: "META"; meta: RunMetadata }
  | { type: "ERROR"; message: string }
  | { type: "RESET" };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "PARSED":
      return {
        ...state,
        phase: "confirm",
        resume: action.resume,
        pdfBase64: action.pdfBase64,
        fileName: action.fileName,
        error: null,
      };
    case "BACK_TO_LANDING":
      return INITIAL_STATE;
    case "START_PENDING":
      return { ...state, phase: "starting", error: null, events: [], meta: null };
    case "STARTED":
      return {
        ...state,
        phase: "live",
        runId: action.runId,
        liveUrl: action.liveUrl,
        ats: action.ats,
      };
    case "EVENT": {
      if (state.events.some((e) => e.id === action.event.id)) return state;
      return { ...state, events: [...state.events, action.event] };
    }
    case "META":
      return { ...state, meta: action.meta, liveUrl: action.meta.liveUrl ?? state.liveUrl };
    case "ERROR":
      return { ...state, error: action.message };
    case "RESET":
      return INITIAL_STATE;
    default:
      return state;
  }
}

export default function Page() {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const sseRef = useRef<EventSource | null>(null);

  useEffect(() => {
    return () => {
      sseRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (!state.runId) return;
    const es = new EventSource(`/api/events/${state.runId}`);
    sseRef.current = es;
    es.addEventListener("agent", (msg) => {
      try {
        const data = JSON.parse((msg as MessageEvent).data);
        dispatch({ type: "EVENT", event: data });
      } catch {
        // ignore
      }
    });
    es.addEventListener("meta", (msg) => {
      try {
        const data = JSON.parse((msg as MessageEvent).data);
        dispatch({ type: "META", meta: data });
      } catch {
        // ignore
      }
    });
    es.addEventListener("done", () => {
      es.close();
    });
    es.onerror = () => {
      // SSE auto-reconnects; do nothing.
    };
    return () => {
      es.close();
    };
  }, [state.runId]);

  return (
    <main className="relative flex min-h-screen flex-col">
      <Brand />
      <AnimatePresence mode="wait">
        {state.phase === "landing" && (
          <Landing
            key="landing"
            onParsed={({ resume, pdfBase64, fileName }) => {
              const parsed = ResumeSchema.safeParse(resume);
              if (!parsed.success) {
                toast.error("Couldn't parse résumé into our schema");
                return;
              }
              dispatch({ type: "PARSED", resume: parsed.data, pdfBase64, fileName });
            }}
            onError={(m) => toast.error(m)}
          />
        )}
        {state.phase === "confirm" && state.resume && (
          <Confirm
            key="confirm"
            resume={state.resume}
            fileName={state.fileName ?? "résumé.pdf"}
            initialUrl={state.jobUrl}
            initialProvider={state.provider}
            onBack={() => dispatch({ type: "BACK_TO_LANDING" })}
            onStart={async (jobUrl: string, provider: LLMProvider) => {
              dispatch({ type: "START_PENDING" });
              const res = await fetch("/api/start", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  resume: state.resume,
                  pdfBase64: state.pdfBase64,
                  jobUrl,
                  provider,
                }),
              });
              if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || `Start failed (${res.status})`);
              }
              const body = await res.json();
              dispatch({
                type: "STARTED",
                runId: body.runId,
                liveUrl: body.liveUrl,
                ats: body.ats,
              });
            }}
          />
        )}
        {(state.phase === "starting" || state.phase === "live") && state.runId && (
          <LiveRun
            key="live"
            runId={state.runId}
            liveUrl={state.liveUrl}
            events={state.events}
            meta={state.meta}
            onRestart={() => dispatch({ type: "RESET" })}
          />
        )}
      </AnimatePresence>
    </main>
  );
}

function Brand() {
  return (
    <div className="pointer-events-none fixed left-6 top-5 z-30">
      <div className="flex items-center gap-2 text-[12px] uppercase tracking-[0.28em] text-foreground/85">
        <span className="font-display lowercase italic tracking-normal text-base">a/a</span>
        <span className="hidden text-foreground/60 sm:inline">AutoApply</span>
      </div>
    </div>
  );
}
