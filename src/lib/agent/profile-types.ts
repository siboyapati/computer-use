/**
 * Shared profile types — server-safe (no browser APIs touched here so
 * runner.ts / field-mapper.ts / API routes can import).
 *
 * Two-part data model that extends the parsed Resume:
 *
 *  1. `extras` — structured fields that ATSes commonly ask but aren't in
 *     the standard résumé schema. Work authorization, salary, start
 *     date, relocation, etc. User pre-fills once on the Settings page.
 *
 *  2. `learnedAnswers` — free-form Q→A dictionary keyed by a NORMALIZED
 *     question hash. Populated either pre-emptively from the Settings
 *     page, or automatically when the user answers a skipped field in
 *     review mode and clicks "Save for next time".
 *
 *  The field-mapper consults both before falling back to the LLM call,
 *  giving zero-cost answers to repeat questions.
 */

export interface ProfileExtras {
  // Work authorization
  workAuthorization?: string;       // e.g. "Yes, US citizen", "F1-OPT"
  requiresSponsorship?: "yes" | "no" | "later";
  // Compensation
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;          // ISO code: "USD", "EUR", "GBP"…
  // Availability
  earliestStartDate?: string;       // ISO date "2026-06-15" or free-form "2 weeks"
  noticePeriodDays?: number;
  // Geography
  willingToRelocate?: boolean;
  preferredLocations?: string[];
  // Experience proxy fields
  yearsExperience?: number;
  // Sourcing
  howDidYouHear?: string;
  referredBy?: string;
}

export interface LearnedAnswer {
  /** The answer the user provided. */
  answer: string;
  /** Whatever the field's `type` was when first learned (text/textarea/select…). */
  fieldType?: string;
  /** Most recent label that matched this normalized key — for diagnostics. */
  lastLabel?: string;
  timesUsed: number;
  lastUsedAt: number;
}

export interface UserProfile {
  extras: ProfileExtras;
  /** Keyed by `normalizeQuestion(label)`. */
  learnedAnswers: Record<string, LearnedAnswer>;
  updatedAt: number;
}

export const EMPTY_PROFILE: UserProfile = {
  extras: {},
  learnedAnswers: {},
  updatedAt: 0,
};

/**
 * Normalize a form-field label into a stable key for the learnedAnswers
 * dictionary. Strips trailing-asterisk required markers, punctuation,
 * whitespace, and case so "Why are you interested in this role?" and
 * "why are you interested in this role" map to the same key.
 */
export function normalizeQuestion(label: string): string {
  return label
    .toLowerCase()
    .replace(/\s*\*\s*$/, "")        // trailing required asterisk
    .replace(/\s*\(required\)\s*$/i, "")
    .replace(/[?:.!,;"'`]/g, "")     // punctuation
    .replace(/\s+/g, " ")            // collapse whitespace
    .trim();
}

/**
 * Heuristic: which ProfileExtras field (if any) does this label correspond
 * to? Maps an incoming form label like "Are you authorized to work in the
 * US?" → "workAuthorization". Returns undefined if no extras field fits.
 */
export function matchExtra(label: string): keyof ProfileExtras | undefined {
  const l = label.toLowerCase();
  if (/(work|legal|right).*(author|eligib)/.test(l) || /authoriz.* to work/.test(l)) {
    return "workAuthorization";
  }
  if (/sponsor|visa.*support|immigration.*support/.test(l)) {
    return "requiresSponsorship";
  }
  if (/salary|compensation|pay.*expect|expected.*pay|comp.*range/.test(l)) {
    // Best-effort: return min for ranges; UI also has separate fields.
    return "salaryMin";
  }
  if (/start.*date|when.*start|availability.*date|earliest/.test(l)) {
    return "earliestStartDate";
  }
  if (/notice.*period|notice.*days|two.*week/.test(l)) {
    return "noticePeriodDays";
  }
  if (/relocat|willing.*move/.test(l)) {
    return "willingToRelocate";
  }
  if (/years.*experience|how.*long.*experience/.test(l)) {
    return "yearsExperience";
  }
  if (/how.*hear|where.*hear|how.*find/.test(l)) {
    return "howDidYouHear";
  }
  if (/referr/.test(l)) {
    return "referredBy";
  }
  return undefined;
}

/**
 * Convert a ProfileExtras value into the string the form expects to see.
 * Booleans become "Yes"/"No"; numbers stringify; strings pass through.
 */
export function extraToString(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}
