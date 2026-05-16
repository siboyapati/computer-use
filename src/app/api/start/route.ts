import { NextResponse } from "next/server";
import { z } from "zod";
import { ResumeSchema, detectATS } from "@/lib/agent/types";
import { createRun, getRun } from "@/lib/agent/events";
import { runApplication, newRunId } from "@/lib/agent/runner";
import { normalizeKeys } from "@/lib/agent/keys";
import { preflightResponse, withCors } from "@/lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return preflightResponse();
}

const UserKeysSchema = z
  .object({
    anthropic: z.string().optional(),
    google: z.string().optional(),
    steel: z.string().optional(),
  })
  .optional();

/**
 * Profile shape — kept loose (z.record + z.any) on the wire because the
 * server doesn't need to validate every extras field. The field-mapper
 * tolerates missing keys, and saving back via /api/learn writes through
 * the typed helpers on the client.
 */
const ProfileSchema = z
  .object({
    extras: z.record(z.string(), z.unknown()).optional(),
    learnedAnswers: z
      .record(
        z.string(),
        z.object({
          answer: z.string(),
          fieldType: z.string().optional(),
          lastLabel: z.string().optional(),
          timesUsed: z.number().optional(),
          lastUsedAt: z.number().optional(),
        }),
      )
      .optional(),
    companyAnswers: z
      .record(
        z.string(),
        z.object({
          label: z.string().optional(),
          answers: z.record(
            z.string(),
            z.object({
              answer: z.string(),
              fieldType: z.string().optional(),
              lastLabel: z.string().optional(),
              timesUsed: z.number().optional(),
              lastUsedAt: z.number().optional(),
            }),
          ),
          updatedAt: z.number().optional(),
        }),
      )
      .optional(),
    updatedAt: z.number().optional(),
  })
  .optional();

const StartSchema = z.object({
  resume: ResumeSchema,
  pdfBase64: z.string().min(1),
  jobUrl: z.string().url(),
  provider: z.enum(["anthropic", "google"]).default("anthropic"),
  reviewMode: z.boolean().default(true),
  /**
   * Optional per-request key overrides from the user's Settings page.
   * Anything missing falls back to the server's env vars.
   */
  userKeys: UserKeysSchema,
  /**
   * Optional UserProfile (extras + learnedAnswers). Field-mapper consults
   * these between deterministic résumé tier and the LLM fallback so the
   * agent reuses answers the user gave on previous runs.
   */
  profile: ProfileSchema,
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = StartSchema.safeParse(body);
    if (!parsed.success) {
      return withCors(NextResponse.json({ error: parsed.error.message }, { status: 400 }));
    }
    const { resume, pdfBase64, jobUrl, provider, reviewMode } = parsed.data;
    const userKeys = normalizeKeys(parsed.data.userKeys);
    // The parsed profile is loosely typed at the route boundary; the
    // field-mapper tolerates missing keys. Cast once here for handoff.
    const profile = parsed.data.profile as
      | import("@/lib/agent/profile-types").UserProfile
      | undefined;
    const ats = detectATS(jobUrl);
    if (!ats) {
      return withCors(
        NextResponse.json(
          {
            error:
              "Unsupported ATS. This demo supports Lever (jobs.lever.co), Greenhouse (job-boards.greenhouse.io), and Ashby (jobs.ashbyhq.com).",
          },
          { status: 400 },
        ),
      );
    }

    // Sanity-check key availability before kicking off the runner so the
    // user gets immediate feedback instead of a mid-run error. Anthropic is
    // required even for Gemini runs because resume parsing and custom
    // question fallback still use the Anthropic SDK.
    if (!(userKeys.anthropic || process.env.ANTHROPIC_API_KEY)) {
      return withCors(
        NextResponse.json(
          {
            error:
              "Anthropic API key not configured. Add it on the Settings page or set ANTHROPIC_API_KEY on the server.",
          },
          { status: 400 },
        ),
      );
    }
    if (
      provider === "google" &&
      !(userKeys.google || process.env.GOOGLE_GENERATIVE_AI_API_KEY)
    ) {
      return withCors(
        NextResponse.json(
          {
            error:
              "Gemini API key not configured. Add it on the Settings page or set GOOGLE_GENERATIVE_AI_API_KEY on the server.",
          },
          { status: 400 },
        ),
      );
    }
    if (!(userKeys.steel || process.env.STEEL_API_KEY)) {
      return withCors(
        NextResponse.json(
          {
            error:
              "Steel API key not configured. Add it on the Settings page or set STEEL_API_KEY on the server.",
          },
          { status: 400 },
        ),
      );
    }

    const runId = newRunId();
    createRun({ runId, jobUrl, ats });

    void runApplication({
      runId,
      resume,
      resumePdfBase64: pdfBase64,
      jobUrl,
      ats,
      provider,
      reviewMode,
      userKeys,
      profile,
    });

    const liveUrl = await waitForLiveUrl(runId, 8000);

    return withCors(NextResponse.json({ runId, liveUrl, ats }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

async function waitForLiveUrl(runId: string, timeoutMs: number): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const run = getRun(runId);
    if (run?.meta.liveUrl) return run.meta.liveUrl;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}
