import { z } from "zod";

export const ResumeSchema = z.object({
  personal: z.object({
    fullName: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    email: z.string().email().or(z.literal("")),
    phone: z.string().default(""),
    location: z.string().default(""),
    linkedin: z.string().default(""),
    github: z.string().default(""),
    website: z.string().default(""),
  }),
  headline: z.string().default(""),
  summary: z.string().default(""),
  experience: z
    .array(
      z.object({
        company: z.string(),
        title: z.string(),
        startDate: z.string().default(""),
        endDate: z.string().default(""),
        location: z.string().default(""),
        description: z.string().default(""),
      }),
    )
    .default([]),
  education: z
    .array(
      z.object({
        school: z.string(),
        degree: z.string().default(""),
        field: z.string().default(""),
        startDate: z.string().default(""),
        endDate: z.string().default(""),
      }),
    )
    .default([]),
  skills: z.array(z.string()).default([]),
  projects: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().default(""),
        url: z.string().default(""),
      }),
    )
    .default([]),
  certifications: z.array(z.string()).default([]),
});

export type Resume = z.infer<typeof ResumeSchema>;

export type ATS = "lever" | "greenhouse" | "ashby";

export type LLMProvider = "anthropic" | "google";

export interface ModelChoice {
  provider: LLMProvider;
  label: string;
  shortLabel: string;
  modelId: string;
}

// Display metadata only — actual model IDs are resolved server-side from env in runner.ts.
export const MODEL_CHOICES: Record<LLMProvider, ModelChoice> = {
  anthropic: {
    provider: "anthropic",
    label: "Claude Haiku 4.5",
    shortLabel: "Claude",
    modelId: "claude-haiku-4-5",
  },
  google: {
    provider: "google",
    label: "Gemini 3 Flash",
    shortLabel: "Gemini",
    modelId: "gemini-3-flash-preview",
  },
};

export function detectATS(url: string): ATS | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host.endsWith("lever.co")) return "lever";
    if (host.endsWith("greenhouse.io") || host.includes("greenhouse")) return "greenhouse";
    if (host.endsWith("ashbyhq.com") || host.includes("ashby")) return "ashby";
    return null;
  } catch {
    return null;
  }
}

export type AgentEventKind =
  | "started"
  | "navigated"
  | "form_extracted"
  | "field_filled"
  | "file_uploaded"
  | "submitting"
  | "submitted"
  | "screenshot"
  | "error"
  | "completed";

export interface AgentEvent {
  id: string;
  runId: string;
  kind: AgentEventKind;
  ts: number;
  message: string;
  data?: Record<string, unknown>;
}

export type RunStatus =
  | "starting"
  | "navigating"
  | "filling"
  | "submitting"
  | "submitted"
  | "failed";

export interface RunMetadata {
  runId: string;
  jobUrl: string;
  ats: ATS;
  liveUrl: string | null;
  status: RunStatus;
  company: string | null;
  startedAt: number;
  finishedAt: number | null;
  screenshotUrl: string | null;
  error: string | null;
}
