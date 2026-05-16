import { NextResponse } from "next/server";
import { parseResumeFromPdf } from "@/lib/agent/resume-parser";
import { preflightResponse, withCors } from "@/lib/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_PDF_BYTES = 5 * 1024 * 1024;

export async function OPTIONS() {
  return preflightResponse();
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return withCors(NextResponse.json({ error: "Missing file" }, { status: 400 }));
    }
    if (file.size > MAX_PDF_BYTES) {
      return withCors(NextResponse.json({ error: "PDF too large (max 5 MB)" }, { status: 400 }));
    }
    if (file.type && !file.type.includes("pdf")) {
      return withCors(NextResponse.json({ error: "Only PDFs are supported" }, { status: 400 }));
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const resume = await parseResumeFromPdf(buf);
    const pdfBase64 = buf.toString("base64");

    return withCors(NextResponse.json({ resume, pdfBase64 }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}
