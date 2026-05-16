"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { Landing } from "@/components/landing";
import { Confirm } from "@/components/confirm";
import { LiveRun } from "@/components/live-run";
import { INITIAL_STATE, type AppState } from "@/lib/client-types";
import { ResumeSchema, type AgentEvent, type LLMProvider, type RunMetadata } from "@/lib/agent/types";
import {
  loadResume,
  saveResume,
  clearResume,
  loadHistory,
  recordRun,
  type HistoryItem,
  type StoredResume,
} from "@/lib/storage";
import {
  SAMPLE_RESUME,
  SAMPLE_FILE_NAME,
  loadSamplePdfBase64,
} from "@/lib/sample-data";

type Action =
  | { type: "PARSED"; resume: AppState["resume"]; pdfBase64: string; fileName: string }
  | { type: "USE_STORED"; resume: AppState["resume"]; pdfBase64: string; fileName: string }
  | { type: "BACK_TO_LANDING" }
  | { type: "APPLY_ANOTHER" }
  | { type: "START_PENDING" }
  | { type: "STARTED"; runId: string; liveUrl: string | null; ats: AppState["ats"] }
  | { type: "EVENT"; event: AgentEvent }
  | { type: "META"; meta: RunMetadata }
  | { type: "ERROR"; message: string }
  | { type: "RESET" };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "PARSED":
    case "USE_STORED":
      return {
        ...state,
        phase: "confirm",
        resume: action.resume,
        pdfBase64: action.pdfBase64,
        fileName: action.fileName,
        error: null,
      };
    case "BACK_TO_LANDING":
      // Keep résumé in state so Landing offers "Use last résumé" without re-upload
      return {
        ...INITIAL_STATE,
        resume: state.resume,
        pdfBase64: state.pdfBase64,
        fileName: state.fileName,
      };
    case "APPLY_ANOTHER":
      // Same as BACK_TO_LANDING but jump straight to confirm so user can paste a new URL
      if (state.resume && state.pdfBase64) {
        return {
          ...INITIAL_STATE,
          phase: "confirm",
          resume: state.resume,
          pdfBase64: state.pdfBase64,
          fileName: state.fileName,
          provider: state.provider,
        };
      }
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
  const [storedResume, setStoredResume] = useState<StoredResume | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // Hydrate from localStorage on first mount (client-only)
  useEffect(() => {
    setStoredResume(loadResume());
    setHistory(loadHistory());
  }, []);

  // Deep-link: if the URL has ?runId=..., jump straight to the live phase.
  // Used by the Chrome extension's "Open in new tab" flow after starting a run.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const runId = params.get("runId");
    if (!runId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/runs/${runId}`);
        if (!res.ok) {
          toast.error("That run isn't available — start a new one");
          return;
        }
        const body = (await res.json()) as { meta: RunMetadata };
        if (cancelled) return;
        dispatch({
          type: "STARTED",
          runId,
          liveUrl: body.meta.liveUrl,
          ats: body.meta.ats,
        });
        if (body.meta) dispatch({ type: "META", meta: body.meta });
        // Drop ?runId= from the URL so refresh doesn't re-trigger
        const url = new URL(window.location.href);
        url.searchParams.delete("runId");
        window.history.replaceState(null, "", url.toString());
      } catch {
        toast.error("Couldn't load the run");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist parsed résumé so it survives refresh
  useEffect(() => {
    if (state.resume && state.pdfBase64 && state.fileName) {
      saveResume({ resume: state.resume, pdfBase64: state.pdfBase64, fileName: state.fileName });
      setStoredResume({
        resume: state.resume,
        pdfBase64: state.pdfBase64,
        fileName: state.fileName,
        storedAt: Date.now(),
      });
    }
  }, [state.resume, state.pdfBase64, state.fileName]);

  // Record finished runs into history
  useEffect(() => {
    if (!state.meta || !state.ats) return;
    if (state.meta.status !== "submitted" && state.meta.status !== "failed") return;
    recordRun(state.meta, state.ats);
    setHistory(loadHistory());
  }, [state.meta, state.ats]);

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
            storedResume={storedResume}
            history={history}
            onUseStoredResume={() => {
              if (!storedResume) return;
              dispatch({
                type: "USE_STORED",
                resume: storedResume.resume,
                pdfBase64: storedResume.pdfBase64,
                fileName: storedResume.fileName,
              });
            }}
            onForgetStoredResume={() => {
              clearResume();
              setStoredResume(null);
              toast.message("Forgot stored résumé");
            }}
            onParsed={({ resume, pdfBase64, fileName }) => {
              const parsed = ResumeSchema.safeParse(resume);
              if (!parsed.success) {
                toast.error("Couldn't parse résumé into our schema");
                return;
              }
              dispatch({ type: "PARSED", resume: parsed.data, pdfBase64, fileName });
            }}
            onUseSample={async () => {
              // The sample flow ships a pre-parsed Resume + a static PDF.
              // Skips the Anthropic call — instant jump to Confirm.
              const pdfBase64 = await loadSamplePdfBase64();
              dispatch({
                type: "USE_STORED",
                resume: SAMPLE_RESUME,
                pdfBase64,
                fileName: SAMPLE_FILE_NAME,
              });
              toast.success("Sample résumé loaded");
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
            onStart={async (jobUrl: string, provider: LLMProvider, reviewMode: boolean) => {
              dispatch({ type: "START_PENDING" });
              const res = await fetch("/api/start", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  resume: state.resume,
                  pdfBase64: state.pdfBase64,
                  jobUrl,
                  provider,
                  reviewMode,
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
            onRestart={() => dispatch({ type: "BACK_TO_LANDING" })}
            onApplyAnother={() => dispatch({ type: "APPLY_ANOTHER" })}
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
