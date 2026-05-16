import type { Resume, AgentEvent, RunMetadata, ATS, LLMProvider } from "./agent/types";

export type AppPhase = "landing" | "parsing" | "confirm" | "starting" | "live" | "done";

export interface AppState {
  phase: AppPhase;
  resume: Resume | null;
  pdfBase64: string | null;
  fileName: string | null;
  jobUrl: string;
  runId: string | null;
  liveUrl: string | null;
  ats: ATS | null;
  provider: LLMProvider;
  events: AgentEvent[];
  meta: RunMetadata | null;
  error: string | null;
}

export const INITIAL_STATE: AppState = {
  phase: "landing",
  resume: null,
  pdfBase64: null,
  fileName: null,
  jobUrl: "",
  runId: null,
  liveUrl: null,
  ats: null,
  provider: "anthropic",
  events: [],
  meta: null,
  error: null,
};
