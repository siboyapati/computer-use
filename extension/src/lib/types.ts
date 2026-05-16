/**
 * Minimal types mirrored from the web app's src/lib/agent/types.ts.
 * Keeps the extension self-contained — no monorepo workspace required.
 */

export type ATS = "lever" | "greenhouse" | "ashby";

export type LLMProvider = "anthropic" | "google";

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

export type ExtensionMessage = PairMessage | ApplyMessage | StatusMessage;
