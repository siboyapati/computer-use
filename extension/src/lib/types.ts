/**
 * Minimal types mirrored from the web app's src/lib/agent/types.ts.
 * Keeps the extension self-contained — no monorepo workspace required.
 */

export type ATS = "lever" | "greenhouse" | "ashby";

export type LLMProvider = "anthropic" | "google";

export type RunStatus =
  | "starting"
  | "navigating"
  | "filling"
  | "awaiting_review"
  | "submitting"
  | "submitted"
  | "failed"
  | "stopped";

export interface Resume {
  personal: {
    fullName: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    location: string;
    linkedin: string;
    github: string;
    website: string;
  };
  headline: string;
  summary: string;
  experience: Array<{
    company: string;
    title: string;
    startDate: string;
    endDate: string;
    location: string;
    description: string;
  }>;
  education: Array<{
    school: string;
    degree: string;
    field: string;
    startDate: string;
    endDate: string;
  }>;
  skills: string[];
  projects: Array<{
    name: string;
    description: string;
    url: string;
  }>;
  certifications: string[];
}

export interface UserKeys {
  anthropic?: string;
  google?: string;
  steel?: string;
}

export interface UserProfile {
  extras?: Record<string, unknown>;
  learnedAnswers?: Record<
    string,
    {
      answer: string;
      fieldType?: string;
      lastLabel?: string;
      timesUsed?: number;
      lastUsedAt?: number;
    }
  >;
  companyAnswers?: Record<
    string,
    {
      label?: string;
      answers?: Record<
        string,
        {
          answer: string;
          fieldType?: string;
          lastLabel?: string;
          timesUsed?: number;
          lastUsedAt?: number;
        }
      >;
      updatedAt?: number;
    }
  >;
  updatedAt?: number;
}

export interface PairedConfig {
  paired: true;
  apiBase: string;
  resume: Resume;
  pdfBase64: string;
  fileName: string;
  pairedAt: number;
  /**
   * Per-extension API key overrides. Optional — if missing, the server
   * uses its env vars. Populated from the web app Settings page during
   * pairing.
   */
  userKeys?: UserKeys;
  /**
   * Saved application profile copied from the web app during pairing.
   * Used server-side before LLM fallback to answer repeated questions.
   */
  profile?: UserProfile;
}

export type StoredConfig = PairedConfig | { paired: false; userKeys?: UserKeys };

export interface ActiveRun {
  runId: string;
  jobUrl: string;
  ats: ATS;
  liveUrl: string | null;
  company: string | null;
  status: RunStatus;
  startedAt: number;
  updatedAt: number;
}

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
  skippedRequired?: string[];
}

export interface PairMessage {
  type: "pair";
  resume: Resume;
  pdfBase64: string;
  fileName: string;
  apiBase: string;
  userKeys?: UserKeys;
  profile?: UserProfile;
}

export interface ApplyMessage {
  type: "apply";
  jobUrl: string;
}

export interface StatusMessage {
  type: "get-status";
}

export interface OpenOptionsMessage {
  type: "open-options";
}

export type ExtensionMessage = PairMessage | ApplyMessage | StatusMessage | OpenOptionsMessage;
