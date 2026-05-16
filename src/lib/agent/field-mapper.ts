import Anthropic from "@anthropic-ai/sdk";
import type { Resume } from "./types";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    client = new Anthropic({ apiKey });
  }
  return client;
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
): Promise<string> {
  const model = process.env.ANTHROPIC_MODEL_DEFAULT || "claude-haiku-4-5";
  const isLong = field.type === "textarea";

  // Cacheable resume block — Anthropic prompt cache hashes the prefix, so 20
  // questions on the same form pay the resume token cost once instead of 20×.
  const resumeBlock = `You are filling out a job application on behalf of a candidate. Answer concisely and truthfully based ONLY on the candidate's resume. Do not invent experience. If the question asks "why are you interested", reference real overlap between the candidate's background and the role. If you genuinely cannot answer from the resume, return an empty string.

Candidate resume (JSON):
${JSON.stringify(resume, null, 2)}`;

  const response = await getClient().messages.create({
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

function findDeclineOption(options: string[] | undefined): string | undefined {
  if (!options || options.length === 0) return undefined;
  return options.find((o) => DECLINE_REGEX.test(o)) ?? options[options.length - 1];
}

export async function mapField(
  field: FormField,
  resume: Resume,
  jobUrl: string,
): Promise<FieldAnswer> {
  const det = deterministicAnswer(field, resume);
  if (det) {
    return { label: field.label, value: det, reasoning: "matched resume directly" };
  }
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
  const value = await answerCustomQuestion(field, resume, jobUrl);
  return { label: field.label, value, reasoning: "generated from resume" };
}
