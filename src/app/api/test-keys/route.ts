/**
 * /api/test-keys
 *
 * Validates a user-provided API key by making a minimal call to the
 * respective provider. Used by the Settings page (web app and extension)
 * so users can verify their keys before kicking off a real run.
 *
 * The key is NEVER persisted server-side. It rides along in this request,
 * gets used for one HTTPS call, and is discarded.
 *
 * Provider-specific test calls (all cheap, well under $0.001 each):
 *   - anthropic: messages.create with 1 max_token "hi"
 *   - google:    minimal generateContent
 *   - steel:     sessions.list (no creation, just a read)
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { preflightResponse, withCors } from "@/lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const TestSchema = z.object({
  provider: z.enum(["anthropic", "google", "steel"]),
  key: z.string().min(8, "Key looks too short"),
});

export async function OPTIONS() {
  return preflightResponse();
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return withCors(NextResponse.json({ error: "Invalid JSON" }, { status: 400 }));
  }
  const parsed = TestSchema.safeParse(body);
  if (!parsed.success) {
    return withCors(NextResponse.json({ error: parsed.error.message }, { status: 400 }));
  }
  const { provider, key } = parsed.data;

  try {
    if (provider === "anthropic") {
      return withCors(NextResponse.json(await testAnthropic(key)));
    }
    if (provider === "google") {
      return withCors(NextResponse.json(await testGoogle(key)));
    }
    if (provider === "steel") {
      return withCors(NextResponse.json(await testSteel(key)));
    }
    return withCors(NextResponse.json({ ok: false, error: "Unknown provider" }, { status: 400 }));
  } catch (err) {
    return withCors(
      NextResponse.json(
        { ok: false, error: err instanceof Error ? err.message : "Test failed" },
        { status: 200 }, // 200 with ok:false so the client renders a normal error state
      ),
    );
  }
}

interface TestResult {
  ok: boolean;
  info?: string;
  error?: string;
}

async function testAnthropic(key: string): Promise<TestResult> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: key });
  try {
    const res = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL_DEFAULT || "claude-haiku-4-5",
      max_tokens: 8,
      messages: [{ role: "user", content: "hi" }],
    });
    const text = res.content
      .filter((b) => b.type === "text")
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    return {
      ok: true,
      info: `Reachable. Model returned ${res.usage?.output_tokens ?? "?"} tokens.${text ? ` Sample: "${text.slice(0, 40)}"` : ""}`,
    };
  } catch (err) {
    return classifyError(err, "anthropic");
  }
}

async function testGoogle(key: string): Promise<TestResult> {
  // Use the REST API directly to avoid pulling in another SDK just for a
  // health check. Endpoint accepts ?key=<apiKey> query auth.
  const model = process.env.GEMINI_MODEL || "gemini-3-flash-preview";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        generationConfig: { maxOutputTokens: 8 },
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      return { ok: false, error: extractError(t) || `HTTP ${res.status}` };
    }
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const sample = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    return {
      ok: true,
      info: `Reachable via Generative Language API.${sample ? ` Sample: "${sample.slice(0, 40)}"` : ""}`,
    };
  } catch (err) {
    return classifyError(err, "google");
  }
}

async function testSteel(key: string): Promise<TestResult> {
  // Cheap health check — list a single session. Doesn't create or release
  // anything, doesn't consume browser-hours.
  try {
    const res = await fetch("https://api.steel.dev/v1/sessions?limit=1", {
      method: "GET",
      headers: { "Steel-Api-Key": key },
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: `Steel rejected the key (HTTP ${res.status}). Check the key value.` };
    }
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ok: false, error: extractError(t) || `HTTP ${res.status}` };
    }
    const data = (await res.json().catch(() => ({}))) as { sessions?: unknown[]; data?: unknown[] };
    const count = data.sessions?.length ?? data.data?.length ?? 0;
    return { ok: true, info: `Reachable. ${count} recent session${count === 1 ? "" : "s"} visible.` };
  } catch (err) {
    return classifyError(err, "steel");
  }
}

function classifyError(err: unknown, provider: string): TestResult {
  const message = err instanceof Error ? err.message : String(err);
  if (/401|403|unauthor|forbidden|invalid.*key|incorrect/i.test(message)) {
    return { ok: false, error: `${provider} rejected the key. Double-check it.` };
  }
  if (/429|rate.?limit/i.test(message)) {
    return { ok: false, error: `${provider} rate-limited the test request — but the key looks valid.` };
  }
  return { ok: false, error: message };
}

function extractError(text: string): string {
  try {
    const obj = JSON.parse(text);
    return obj?.error?.message ?? obj?.error ?? text.slice(0, 200);
  } catch {
    return text.slice(0, 200);
  }
}
