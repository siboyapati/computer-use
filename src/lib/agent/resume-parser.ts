import Anthropic from "@anthropic-ai/sdk";
import { ResumeSchema, type Resume } from "./types";

let defaultClient: Anthropic | null = null;

function getDefaultClient(): Anthropic {
  if (!defaultClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    defaultClient = new Anthropic({ apiKey });
  }
  return defaultClient;
}

// Construct a fresh client when a user-provided key is passed; otherwise
// reuse the cached default client. Per-request keys never get stored.
function clientFor(apiKey?: string): Anthropic {
  if (apiKey) return new Anthropic({ apiKey });
  return getDefaultClient();
}

const TOOL = {
  name: "save_resume",
  description:
    "Save the structured representation of the candidate's resume so it can be used to auto-fill job application forms.",
  input_schema: {
    type: "object" as const,
    properties: {
      personal: {
        type: "object",
        properties: {
          fullName: { type: "string" },
          firstName: { type: "string" },
          lastName: { type: "string" },
          email: { type: "string" },
          phone: { type: "string" },
          location: { type: "string" },
          linkedin: { type: "string" },
          github: { type: "string" },
          website: { type: "string" },
        },
        required: ["fullName", "firstName", "lastName", "email"],
      },
      headline: { type: "string", description: "Short professional headline, e.g. 'Senior Software Engineer'." },
      summary: { type: "string", description: "2-3 sentence professional summary." },
      experience: {
        type: "array",
        items: {
          type: "object",
          properties: {
            company: { type: "string" },
            title: { type: "string" },
            startDate: { type: "string" },
            endDate: { type: "string", description: "Use 'Present' if current." },
            location: { type: "string" },
            description: { type: "string" },
          },
          required: ["company", "title"],
        },
      },
      education: {
        type: "array",
        items: {
          type: "object",
          properties: {
            school: { type: "string" },
            degree: { type: "string" },
            field: { type: "string" },
            startDate: { type: "string" },
            endDate: { type: "string" },
          },
          required: ["school"],
        },
      },
      skills: { type: "array", items: { type: "string" } },
      projects: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            url: { type: "string" },
          },
          required: ["name"],
        },
      },
      certifications: { type: "array", items: { type: "string" } },
    },
    required: ["personal"],
  },
};

export async function parseResumeFromPdf(
  pdfBuffer: Buffer,
  apiKey?: string,
): Promise<Resume> {
  const model = process.env.ANTHROPIC_MODEL_DEFAULT || "claude-haiku-4-5";
  const response = await clientFor(apiKey).messages.create({
    model,
    max_tokens: 4096,
    tools: [TOOL],
    tool_choice: { type: "tool", name: TOOL.name },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: pdfBuffer.toString("base64"),
            },
          },
          {
            type: "text",
            text: "Extract this resume into the save_resume tool. Be faithful to what's on the page; do not invent fields. For dates, prefer 'MMM YYYY' format (e.g., 'Jan 2024'). Use empty string for unknown fields, not nulls.",
          },
        ],
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Anthropic did not return a tool_use block");
  }
  return ResumeSchema.parse(toolUse.input);
}
