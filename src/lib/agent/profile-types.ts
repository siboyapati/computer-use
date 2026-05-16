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
 *  giving zero-cost answers to repeat questions. Question variants are
 *  matched with a local semantic embedding so "Why this job?" can reuse
 *  "What interests you about this role?" without calling an external
 *  embeddings API.
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

export interface SemanticQuestionMatch {
  key: string;
  score: number;
}

export const SEMANTIC_QUESTION_MATCH_THRESHOLD = 0.52;

const STOPWORDS = new Set([
  "a",
  "about",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "could",
  "do",
  "does",
  "for",
  "from",
  "have",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "our",
  "please",
  "required",
  "that",
  "the",
  "this",
  "to",
  "us",
  "we",
  "with",
  "you",
  "your",
]);

const TOKEN_ALIASES: Record<string, string> = {
  applying: "apply",
  application: "apply",
  attracted: "interest",
  attractive: "interest",
  compensation: "salary",
  eligibility: "eligible",
  employer: "company",
  excited: "interest",
  exciting: "interest",
  hear: "source",
  heard: "source",
  interested: "interest",
  interesting: "interest",
  interests: "interest",
  job: "role",
  joining: "join",
  opportunity: "role",
  organization: "company",
  position: "role",
  referred: "referral",
  referring: "referral",
  relocation: "relocate",
  salary: "salary",
  sponsorship: "sponsor",
  start: "start",
  starting: "start",
  visa: "sponsor",
  work: "work",
};

const CONCEPT_PATTERNS: Array<{ concept: string; match: RegExp }> = [
  {
    concept: "intent_interest_motivation",
    match: /\b(why|interest|interests|interested|attract|appeal|motivat|excite|excited|want|drawn|apply|join)\b/,
  },
  {
    concept: "intent_interest_role",
    match:
      /\b(why|interest|interests|interested|attract|appeal|motivat|excite|want|drawn|apply|join)\b.*\b(role|job|position|opportunity|company|team|work|here)\b|\b(role|job|position|opportunity|company|team|work|here)\b.*\b(interest|interests|interested|attract|appeal|motivat|excite|want|drawn|apply|join)\b/,
  },
  {
    concept: "intent_work_authorization",
    match: /(authori|eligible|eligib|legal|right).*(work|employ)|(work|employ).*(authori|eligible|eligib|legal|right)/,
  },
  {
    concept: "intent_sponsorship",
    match: /sponsor|visa.*support|immigration.*support|work.*visa/,
  },
  {
    concept: "intent_compensation",
    match: /salary|compensation|pay.*expect|expected.*pay|comp.*range|desired.*pay/,
  },
  {
    concept: "intent_start_date",
    match: /start.*date|when.*start|availability.*date|available.*start|earliest/,
  },
  {
    concept: "intent_referral_source",
    match: /how.*hear|where.*hear|how.*find|where.*find|source|referred|referral/,
  },
  {
    concept: "intent_relocation",
    match: /relocat|willing.*move/,
  },
  {
    concept: "intent_experience_years",
    match: /years.*experience|how.*long.*experience/,
  },
  {
    concept: "intent_additional_info",
    match: /(anything|additional).*information|anything.*else|cover.*letter/,
  },
];

export function semanticQuestionSimilarity(left: string, right: string): number {
  const leftEmbedding = embedQuestion(left);
  const rightEmbedding = embedQuestion(right);
  return cosineSimilarity(leftEmbedding, rightEmbedding);
}

export function findBestSemanticQuestionMatch(
  labelOrKey: string,
  candidateKeys: Iterable<string>,
  threshold = SEMANTIC_QUESTION_MATCH_THRESHOLD,
): SemanticQuestionMatch | null {
  const fieldKey = normalizeQuestion(labelOrKey);
  if (!fieldKey) return null;

  let best: SemanticQuestionMatch | null = null;
  for (const candidateKey of candidateKeys) {
    const key = normalizeQuestion(candidateKey) || candidateKey;
    if (!key) continue;
    if (key === fieldKey) return { key: candidateKey, score: 1 };

    const score = semanticQuestionSimilarity(fieldKey, key);
    if (!best || score > best.score) best = { key: candidateKey, score };
  }

  return best && best.score >= threshold ? best : null;
}

function embedQuestion(question: string): Map<string, number> {
  const normalized = normalizeQuestion(question);
  const vector = new Map<string, number>();
  const tokens = normalized
    .split(" ")
    .map(canonicalToken)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));

  for (const token of tokens) addFeature(vector, `tok:${token}`, 1);
  for (let i = 0; i < tokens.length - 1; i += 1) {
    addFeature(vector, `bi:${tokens[i]}_${tokens[i + 1]}`, 1.35);
  }

  for (const { concept, match } of CONCEPT_PATTERNS) {
    if (match.test(normalized)) addFeature(vector, `concept:${concept}`, 3);
  }

  // Character n-grams give a little resilience for labels like
  // "authorised" vs "authorized" without overpowering intent concepts.
  const compact = normalized.replace(/\s+/g, "");
  for (let i = 0; i <= compact.length - 4; i += 1) {
    addFeature(vector, `char:${compact.slice(i, i + 4)}`, 0.18);
  }

  return vector;
}

function canonicalToken(token: string): string {
  const trimmed = token
    .replace(/’/g, "'")
    .replace(/'s$/g, "")
    .replace(/[^a-z0-9]/g, "");
  if (!trimmed) return "";
  const aliased = TOKEN_ALIASES[trimmed] ?? trimmed;
  return TOKEN_ALIASES[stemToken(aliased)] ?? stemToken(aliased);
}

function stemToken(token: string): string {
  if (token.length <= 4) return token;
  return token
    .replace(/ization$/g, "ize")
    .replace(/isation$/g, "ize")
    .replace(/ments$/g, "ment")
    .replace(/ing$/g, "")
    .replace(/ed$/g, "")
    .replace(/ies$/g, "y")
    .replace(/s$/g, "");
}

function addFeature(vector: Map<string, number>, feature: string, weight: number): void {
  vector.set(feature, (vector.get(feature) ?? 0) + weight);
}

function cosineSimilarity(left: Map<string, number>, right: Map<string, number>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (const value of left.values()) leftNorm += value * value;
  for (const value of right.values()) rightNorm += value * value;

  const [small, large] = left.size < right.size ? [left, right] : [right, left];
  for (const [feature, value] of small.entries()) {
    dot += value * (large.get(feature) ?? 0);
  }

  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
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
