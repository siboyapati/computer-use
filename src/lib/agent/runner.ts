import { Stagehand } from "@browserbasehq/stagehand";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createSession, releaseSession } from "./steel";
import { emit, updateMeta, finishRun, getRun } from "./events";
import { mapField, type FormField } from "./field-mapper";
import {
  extractLeverForm,
  uploadResume as leverUpload,
  clickSubmit as leverSubmit,
  type ExtractedForm,
} from "./adapters/lever";
import {
  extractGreenhouseForm,
  uploadResume as ghUpload,
  clickSubmit as ghSubmit,
} from "./adapters/greenhouse";
import {
  extractAshbyForm,
  uploadResume as ashbyUpload,
  clickSubmit as ashbySubmit,
} from "./adapters/ashby";
import type { ATS, LLMProvider, Resume } from "./types";

interface RunArgs {
  runId: string;
  resume: Resume;
  resumePdfBase64: string;
  jobUrl: string;
  ats: ATS;
  provider: LLMProvider;
}

function resolveStagehandModel(provider: LLMProvider): { modelName: string; apiKey: string } {
  if (provider === "google") {
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey) {
      throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set — cannot use the Gemini agent");
    }
    const model = process.env.GEMINI_MODEL || "gemini-3-flash-preview";
    return { modelName: `google/${model}`, apiKey };
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const model = process.env.ANTHROPIC_MODEL_DEFAULT || "claude-haiku-4-5";
  return { modelName: `anthropic/${model}`, apiKey };
}

const ADAPTERS: Record<
  ATS,
  {
    extract: (s: Stagehand) => Promise<ExtractedForm>;
    upload: (s: Stagehand, path: string) => Promise<boolean>;
    submit: (s: Stagehand) => Promise<void>;
  }
> = {
  lever: { extract: extractLeverForm, upload: leverUpload, submit: leverSubmit },
  greenhouse: { extract: extractGreenhouseForm, upload: ghUpload, submit: ghSubmit },
  ashby: { extract: extractAshbyForm, upload: ashbyUpload, submit: ashbySubmit },
};

async function writeResumePdfToTemp(base64: string, runId: string): Promise<string> {
  const dir = join(tmpdir(), "autoapply", runId);
  await mkdir(dir, { recursive: true });
  const path = join(dir, "resume.pdf");
  await writeFile(path, Buffer.from(base64, "base64"));
  return path;
}

export async function runApplication(args: RunArgs): Promise<void> {
  const { runId, resume, resumePdfBase64, jobUrl, ats, provider } = args;
  const adapter = ADAPTERS[ats];

  let session: Awaited<ReturnType<typeof createSession>> | null = null;
  let stagehand: Stagehand | null = null;

  try {
    const { modelName, apiKey } = resolveStagehandModel(provider);
    emit(
      runId,
      "started",
      `Starting application for ${ats.toUpperCase()} posting (using ${modelName})`,
      { provider, modelName },
    );

    session = await createSession();
    updateMeta(runId, { liveUrl: session.sessionViewerUrl });
    emit(runId, "started", "Cloud browser session ready", {
      liveUrl: session.sessionViewerUrl,
    });

    stagehand = new Stagehand({
      env: "LOCAL",
      verbose: 0,
      disablePino: true,
      localBrowserLaunchOptions: {
        cdpUrl: session.websocketUrl,
      },
      model: {
        modelName: modelName as never,
        apiKey,
      },
    });
    await stagehand.init();

    updateMeta(runId, { status: "navigating" });
    emit(runId, "navigated", `Navigating to ${new URL(jobUrl).hostname}`);
    const page = stagehand.context.activePage();
    if (!page) throw new Error("Stagehand failed to create a page");
    await page.goto(jobUrl, { waitUntil: "load", timeoutMs: 30_000 });

    emit(runId, "navigated", "Page loaded — reading form");

    const form = await adapter.extract(stagehand);
    updateMeta(runId, { company: form.company, status: "filling" });
    emit(runId, "form_extracted", `Detected ${form.fields.length} fields at ${form.company}`, {
      company: form.company,
      fieldCount: form.fields.length,
      fields: form.fields.map((f) => ({ label: f.label, type: f.type, required: f.required })),
    });

    const resumePdfPath = await writeResumePdfToTemp(resumePdfBase64, runId);

    const fillable = form.fields.filter((f) => f.type !== "file");
    for (const field of fillable) {
      try {
        const answer = await mapField(field, resume, jobUrl);
        if (!answer.value) {
          emit(runId, "field_filled", `Skipping ${field.label} (no value)`, {
            label: field.label,
            skipped: true,
          });
          continue;
        }
        await fillSingleField(stagehand, field, answer.value);
        emit(runId, "field_filled", `Filled ${field.label}`, {
          label: field.label,
          value: redact(answer.value),
          reasoning: answer.reasoning,
        });
      } catch (err) {
        emit(runId, "error", `Failed to fill ${field.label}: ${(err as Error).message}`, {
          label: field.label,
        });
      }
    }

    if (form.resumeFieldLabel) {
      const ok = await adapter.upload(stagehand, resumePdfPath);
      emit(
        runId,
        "file_uploaded",
        ok ? `Uploaded resume.pdf to ${form.resumeFieldLabel}` : "Resume upload failed",
        { ok },
      );
    }

    updateMeta(runId, { status: "submitting" });
    emit(runId, "submitting", "Clicking Submit");
    await adapter.submit(stagehand);

    await page.waitForLoadState?.("networkidle", 15_000).catch(() => {});

    const screenshotBuf = await page.screenshot({ fullPage: true });
    const screenshotData = `data:image/png;base64,${screenshotBuf.toString("base64")}`;
    updateMeta(runId, { screenshotUrl: screenshotData, status: "submitted" });
    emit(runId, "screenshot", "Captured submission screenshot", {
      url: screenshotData,
    });
    emit(runId, "submitted", `Submitted to ${form.company}`);
    finishRun(runId, "submitted");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit(runId, "error", message);
    finishRun(runId, "failed", message);
  } finally {
    if (stagehand) {
      try {
        await stagehand.close();
      } catch {
        // best-effort
      }
    }
    if (session) {
      releaseSession(session.id);
    }
  }
}

async function fillSingleField(stagehand: Stagehand, field: FormField, value: string): Promise<void> {
  const page = stagehand.context.activePage();
  if (!page) throw new Error("No active page");

  if (field.type === "text" || field.type === "email" || field.type === "phone" || field.type === "url") {
    const ok = await tryFillByLabel(stagehand, field.label, value);
    if (ok) return;
  }

  if (field.type === "textarea") {
    const ok = await tryFillByLabel(stagehand, field.label, value);
    if (ok) return;
  }

  await stagehand.act(`Fill the "${field.label}" field with: ${value}`);
}

async function tryFillByLabel(stagehand: Stagehand, label: string, value: string): Promise<boolean> {
  try {
    const page = stagehand.context.activePage();
    if (!page) return false;
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const candidates = [
      `label:has-text("${escaped}") >> .. >> input`,
      `label:has-text("${escaped}") >> .. >> textarea`,
      `input[aria-label*="${escaped}" i]`,
      `textarea[aria-label*="${escaped}" i]`,
      `input[placeholder*="${escaped}" i]`,
    ];
    for (const sel of candidates) {
      try {
        const loc = page.locator(sel).first();
        if ((await loc.count()) > 0) {
          await loc.fill(value);
          return true;
        }
      } catch {
        // try next
      }
    }
    return false;
  } catch {
    return false;
  }
}

function redact(value: string): string {
  if (value.length <= 4) return value;
  if (value.includes("@")) {
    const [user, domain] = value.split("@");
    return `${user.slice(0, 2)}***@${domain}`;
  }
  if (value.length > 60) return value.slice(0, 60) + "…";
  return value;
}

export function newRunId(): string {
  return randomUUID();
}
