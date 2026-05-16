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
  const sys = `You are filling out a job application on behalf of a candidate. Answer the question concisely and truthfully based ONLY on the candidate's resume. Do not invent experience. If the question asks "why are you interested", reference real overlap between the candidate's background and the role. If you genuinely cannot answer from the resume, return an empty string.

Candidate resume (JSON):
${JSON.stringify(resume, null, 2)}

Job URL: ${jobUrl}`;

  const response = await getClient().messages.create({
    model,
    max_tokens: isLong ? 400 : 80,
    system: sys,
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

export async function mapField(
  field: FormField,
  resume: Resume,
  jobUrl: string,
): Promise<FieldAnswer> {
  const det = deterministicAnswer(field, resume);
  if (det) {
    return { label: field.label, value: det, reasoning: "matched resume directly" };
  }
  if (/race|ethnic|gender|disab|veteran|hispanic|latino|sex\b|pronoun/i.test(field.label)) {
    const decline = field.options?.find((o) =>
      /decline|prefer not|do not wish/i.test(o),
    );
    return {
      label: field.label,
      value: decline ?? "",
      reasoning: "EEO question — declined by default",
    };
  }
  const value = await answerCustomQuestion(field, resume, jobUrl);
  return { label: field.label, value, reasoning: "generated from resume" };
}
