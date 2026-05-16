/**
 * /api/env-keys
 *
 * Returns API keys configured in the server's local environment so the
 * Settings page can pre-populate empty slots on first load. Single-user
 * demo trade-off: the same browser already stores these in localStorage
 * once entered, so reading them out from the dev env is no worse than the
 * existing model.
 *
 * Hard-gated: in production the response is always `{ keys: {} }` so a
 * multi-user deployment can't leak its env vars to any visitor.
 */

import { NextResponse } from "next/server";
import { preflightResponse, withCors } from "@/lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return preflightResponse();
}

const PLACEHOLDER_ANTHROPIC = "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";
const PLACEHOLDER_STEEL = "ste-DrPzkhwyEftsPHHJ2oGekUSYCFqCtcbv2OvDiseAxNfkZjz7156jrCpGzf3rwqjPJqpFgKqBs0APznUCa83B9sAjfgpjg0T6YX5";

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return withCors(NextResponse.json({ keys: {} }));
  }
  const anthropic = process.env.ANTHROPIC_API_KEY?.trim();
  const steel = process.env.STEEL_API_KEY?.trim();
  const google = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();

  const keys = {
    anthropic: (anthropic && anthropic !== PLACEHOLDER_ANTHROPIC) ? anthropic : undefined,
    google: google || undefined,
    steel: (steel && steel !== PLACEHOLDER_STEEL) ? steel : undefined,
  };
  return withCors(NextResponse.json({ keys }));
}
