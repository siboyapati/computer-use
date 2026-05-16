/**
 * Field mapper — given a single form field + the parsed résumé + the job
 * URL, return the value to fill into that field.
 *
 * Five-tier strategy, cheapest-first:
 *   1.  Deterministic dictionary (regex on the label → résumé key).
 *       Zero tokens. Covers name/email/phone/LinkedIn/etc.
 *  1.5. EEO heuristic for demographic fields. Returns an explicit
 *       "decline" option if available, else empty string. This runs before
 *       saved answers so sensitive demographic answers are never reused
 *       accidentally.
 *  1.6. Profile extras — structured ATS-specific fields the user
 *       pre-populated on the Settings page (work auth, salary, start
 *       date, etc). Zero tokens.
 *  1.7. Learned answers — exact or semantic match on a normalized
 *       question key. Populated from Settings or review mode. Zero tokens.
 *   3.  LLM fallback. One Claude call per question, with the résumé in a
 *       cacheable system block (cache_control: ephemeral) so 20 questions
 *       on the same form pay the résumé token cost once.
 *
 * See docs/features/field-mapping.md for the full algorithm + verification.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Resume } from "./types";
import {
  extraToString,
  findBestSemanticQuestionMatch,
  matchExtra,
  normalizeQuestion,
  type UserProfile,
} from "./profile-types";

let defaultClient: Anthropic | null = null;

function getDefaultClient(): Anthropic {
  if (!defaultClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    defaultClient = new Anthropic({ apiKey });
  }
  return defaultClient;
}

// Construct a fresh client when a per-request key is provided.
function clientFor(apiKey?: string): Anthropic {
  if (apiKey) return new Anthropic({ apiKey });
  return getDefaultClient();
}

export interface FormField {
  label: string;
  type: "text" | "email" | "phone" | "url" | "textarea" | "select" | "radio" | "checkbox" | "file" | "other";
  required: boolean;
  options?: string[];
}

export interface FieldAnswer {
  label: string;
  value: string;
  reasoning: string;
}

const DETERMINISTIC: Array<{ match: RegExp; key: (r: Resume) => string }> = [
  { match: /^(full\s*)?name$/i, key: (r) => r.personal.fullName },
  { match: /first\s*name|given\s*name|forename/i, key: (r) => r.personal.firstName },
  { match: /last\s*name|surname|family\s*name/i, key: (r) => r.personal.lastName },
  { match: /^e?-?mail( address)?$/i, key: (r) => r.personal.email },
  { match: /phone|mobile|cell|telephone/i, key: (r) => r.personal.phone },
  { match: /linked\s*in/i, key: (r) => r.personal.linkedin },
  { match: /github|git hub/i, key: (r) => r.personal.github },
  { match: /portfolio|website|personal\s*site|url/i, key: (r) => r.personal.website },
  { match: /^(city|location|where.*based|address|current location)/i, key: (r) => r.personal.location },
  { match: /current\s*(company|employer)/i, key: (r) => r.experience[0]?.company ?? "" },
  { match: /current\s*(title|role|position)/i, key: (r) => r.experience[0]?.title ?? "" },
  { match: /^school|university|college/i, key: (r) => r.education[0]?.school ?? "" },
  { match: /^degree/i, key: (r) => r.education[0]?.degree ?? "" },
  { match: /^headline|tagline/i, key: (r) => r.headline },
];

export function deterministicAnswer(field: FormField, resume: Resume): string | null {
  for (const { match, key } of DETERMINISTIC) {
    if (match.test(field.label)) {
      const v = key(resume);
      if (v) return v;
    }
  }
  return null;
}

export async function answerCustomQuestion(
  field: FormField,
  resume: Resume,
  jobUrl: string,
  apiKey?: string,
): Promise<string> {
  const model = process.env.ANTHROPIC_MODEL_DEFAULT || "claude-haiku-4-5";
  const isLong = field.type === "textarea";

  // Cacheable resume block — Anthropic prompt cache hashes the prefix, so 20
  // questions on the same form pay the resume token cost once instead of 20×.
  const resumeBlock = `You are filling out a job application on behalf of a candidate. Answer concisely and truthfully based ONLY on the candidate's resume. Do not invent experience. If the question asks "why are you interested", reference real overlap between the candidate's background and the role. If you genuinely cannot answer from the resume, return an empty string.

Candidate resume (JSON):
${JSON.stringify(resume, null, 2)}`;

  const response = await clientFor(apiKey).messages.create({
    model,
    max_tokens: isLong ? 400 : 80,
    system: [
      { type: "text", text: resumeBlock, cache_control: { type: "ephemeral" } },
      { type: "text", text: `Job URL: ${jobUrl}` },
    ],
    messages: [
      {
        role: "user",
        content: `Form field label: "${field.label}"
Field type: ${field.type}${field.options ? `\nOptions (pick one verbatim if matching): ${field.options.join(" | ")}` : ""}

Return ONLY the value to enter into this field. No preamble, no quotes, no commentary.`,
      },
    ],
  });

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") return "";
  return block.text.trim().replace(/^["']|["']$/g, "");
}

const DECLINE_REGEX = /decline|prefer not|do not wish|don.?t wish|rather not|not.*say|not.*answer|wish.*disclose/i;
const EEO_REGEX = /race|ethnic|gender|disab|veteran|hispanic|latino|sex\b|pronoun|orientation|identify/i;

/**
 * For an EEO/demographic dropdown, find an option that explicitly declines
 * to answer (e.g. "Prefer not to say", "Decline to disclose").
 *
 * Returns `undefined` if the list has nothing decline-shaped — DO NOT fall
 * back to the last option in the list, because that could be a real
 * demographic answer ("Black or African American", "Veteran of the U.S.
 * Armed Forces") and silently submitting it on the user's behalf is a
 * privacy violation. An empty value means "leave the field blank", which
 * the user can manually correct from the live browser pane (review mode)
 * if needed.
 */
function findDeclineOption(options: string[] | undefined): string | undefined {
  if (!options || options.length === 0) return undefined;
  return options.find((o) => DECLINE_REGEX.test(o));
}

/**
 * Look up a profile-derived answer for this field (Tiers 1.6 + 1.7).
 *
 * Priority order within the profile:
 *   - extras (heuristic label → structured field match) — the user filled
 *     in a known ATS field like "salary range" on the Settings page.
 *   - learnedAnswers (exact or semantic normalized-question match) — the
 *     user already answered this question or a close variant.
 *
 * Returns undefined when the profile has no relevant data.
 */
function profileAnswer(
  field: FormField,
  profile: UserProfile | undefined,
): { value: string; reasoning: string } | undefined {
  if (!profile) return undefined;
  const learnedAnswers = profile.learnedAnswers ?? {};
  const extras = profile.extras ?? {};

  // 1.6: heuristic match against structured `extras`.
  const extrasKey = matchExtra(field.label);
  if (extrasKey) {
    if (extrasKey === "salaryMin") {
      // For salary-shaped questions, fall back to formatting the range
      // if we have one.
      const min = extras.salaryMin;
      const max = extras.salaryMax;
      const cur = extras.salaryCurrency || "USD";
      if (min && max) {
        return {
          value: `${cur} ${min.toLocaleString()}–${max.toLocaleString()}`,
          reasoning: "profile: salary range",
        };
      }
      if (min) {
        return {
          value: `${cur} ${min.toLocaleString()}`,
          reasoning: "profile: salary minimum",
        };
      }
    }
    const v = extraToString(extras[extrasKey]);
    if (v) return { value: v, reasoning: `profile: ${extrasKey}` };
  }

  // 1.7: exact or semantic match against the learnedAnswers dictionary.
  const key = normalizeQuestion(field.label);
  const learned = key ? findSavedAnswer(key, learnedAnswers) : undefined;
  if (learned?.answer) {
    const timesUsed = learned.answer.timesUsed ?? 0;
    return {
      value: learned.answer.answer,
      reasoning:
        learned.score === 1
          ? timesUsed > 0
            ? `saved answer (used ${timesUsed}x before)`
            : "saved answer"
          : `semantic saved answer (${Math.round(learned.score * 100)}% match)`,
    };
  }

  return undefined;
}

function findSavedAnswer(
  fieldKey: string,
  learnedAnswers: UserProfile["learnedAnswers"],
): { answer: UserProfile["learnedAnswers"][string]; score: number } | undefined {
  const exact = learnedAnswers[fieldKey];
  if (exact) return { answer: exact, score: 1 };

  const match = findBestSemanticQuestionMatch(
    fieldKey,
    Object.keys(learnedAnswers).filter((key) => Boolean(learnedAnswers[key]?.answer)),
  );
  if (!match) return undefined;
  return { answer: learnedAnswers[match.key], score: match.score };
}

function coerceToOption(value: string, options: string[] | undefined): string {
  if (!options || options.length === 0) return value;
  const trimmed = value.trim();
  if (!trimmed) return value;

  const exact = options.find((option) => option === trimmed);
  if (exact) return exact;

  const lower = trimmed.toLowerCase();
  const caseInsensitive = options.find((option) => option.trim().toLowerCase() === lower);
  if (caseInsensitive) return caseInsensitive;

  const normalizedValue = normalizeOption(trimmed);
  const normalized = options.map((option) => ({
    option,
    value: normalizeOption(option),
  }));

  const normalizedExact = normalized.find(({ value: optionValue }) => optionValue === normalizedValue);
  if (normalizedExact) return normalizedExact.option;

  const yesNoIntent = inferYesNoIntent(normalizedValue);
  if (yesNoIntent) {
    const yesNoMatch = normalized.find(({ value: optionValue }) =>
      yesNoIntent === "yes"
        ? optionValue === "yes" || optionValue.startsWith("yes ")
        : optionValue === "no" || optionValue.startsWith("no "),
    );
    if (yesNoMatch) return yesNoMatch.option;
  }

  if (/\blater\b|\bfuture\b/.test(normalizedValue)) {
    const laterMatch = normalized.find(({ value: optionValue }) =>
      /\blater\b|\bfuture\b/.test(optionValue),
    );
    if (laterMatch) return laterMatch.option;
  }

  return value;
}

function normalizeOption(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferYesNoIntent(normalizedValue: string): "yes" | "no" | null {
  if (/^(yes|yep|yeah|true)\b/.test(normalizedValue)) return "yes";
  if (/^(no|nope|false)\b/.test(normalizedValue)) return "no";
  if (/\b(do not|don t|dont|not require|not need|cannot|can not)\b/.test(normalizedValue)) {
    return "no";
  }
  if (/\b(am|currently|already|legally)\b.*\b(authori|eligible|able)\b/.test(normalizedValue)) {
    return "yes";
  }
  return null;
}

/**
 * Map a single form field to a value to fill in. See file header for the
 * full tier ordering.
 *
 * If the result is an empty string, the runner skips filling that field
 * (emits a "skipped" event so the user sees why).
 */
export async function mapField(
  field: FormField,
  resume: Resume,
  jobUrl: string,
  apiKey?: string,
  profile?: UserProfile,
): Promise<FieldAnswer> {
  // Tier 1: deterministic résumé key.
  const det = deterministicAnswer(field, resume);
  if (det) {
    return { label: field.label, value: det, reasoning: "matched resume directly" };
  }

  // Tier 1.5: EEO heuristic, before any saved profile answer.
  if (EEO_REGEX.test(field.label)) {
    const decline = findDeclineOption(field.options);
    return {
      label: field.label,
      value: decline ?? "",
      reasoning: decline
        ? `EEO question — picked "${decline}"`
        : "EEO question — no decline option, left blank",
    };
  }

  // Tier 1.6 + 1.7: profile.
  const profileHit = profileAnswer(field, profile);
  if (profileHit) {
    const value = coerceToOption(profileHit.value, field.options);
    return {
      label: field.label,
      value,
      reasoning:
        value === profileHit.value
          ? profileHit.reasoning
          : `${profileHit.reasoning}; matched option "${value}"`,
    };
  }

  // Tier 3: LLM fallback.
  const value = await answerCustomQuestion(field, resume, jobUrl, apiKey);
  const optionValue = coerceToOption(value, field.options);
  return {
    label: field.label,
    value: optionValue,
    reasoning:
      optionValue === value
        ? "generated from resume"
        : `generated from resume; matched option "${optionValue}"`,
  };
}
