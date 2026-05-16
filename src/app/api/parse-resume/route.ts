import { NextResponse } from "next/server";
import { parseResumeFromPdf } from "@/lib/agent/resume-parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_PDF_BYTES = 5 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }
    if (file.size > MAX_PDF_BYTES) {
      return NextResponse.json({ error: "PDF too large (max 5 MB)" }, { status: 400 });
    }
    if (file.type && !file.type.includes("pdf")) {
      return NextResponse.json({ error: "Only PDFs are supported" }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const resume = await parseResumeFromPdf(buf);
    const pdfBase64 = buf.toString("base64");

    return NextResponse.json({ resume, pdfBase64 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
