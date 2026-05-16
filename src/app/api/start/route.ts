import { NextResponse } from "next/server";
import { z } from "zod";
import { ResumeSchema, detectATS } from "@/lib/agent/types";
import { createRun, getRun } from "@/lib/agent/events";
import { runApplication, newRunId } from "@/lib/agent/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const StartSchema = z.object({
  resume: ResumeSchema,
  pdfBase64: z.string().min(1),
  jobUrl: z.string().url(),
  provider: z.enum(["anthropic", "google"]).default("anthropic"),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = StartSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    }
    const { resume, pdfBase64, jobUrl, provider } = parsed.data;
    const ats = detectATS(jobUrl);
    if (!ats) {
      return NextResponse.json(
        {
          error:
            "Unsupported ATS. This demo supports Lever (jobs.lever.co), Greenhouse (job-boards.greenhouse.io), and Ashby (jobs.ashbyhq.com).",
        },
        { status: 400 },
      );
    }

    if (provider === "google" && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      return NextResponse.json(
        { error: "Gemini agent isn't configured — set GOOGLE_GENERATIVE_AI_API_KEY in .env.local" },
        { status: 400 },
      );
    }

    const runId = newRunId();
    createRun({ runId, jobUrl, ats });

    void runApplication({ runId, resume, resumePdfBase64: pdfBase64, jobUrl, ats, provider });

    // Wait briefly so we can return liveUrl in the initial response
    const liveUrl = await waitForLiveUrl(runId, 8000);

    return NextResponse.json({ runId, liveUrl, ats });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
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
