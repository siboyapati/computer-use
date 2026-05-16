import { Stagehand } from "@browserbasehq/stagehand";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createSession, releaseSession } from "./steel";
import {
  emit,
  updateMeta,
  finishRun,
  isStopRequested,
  isSubmitRequested,
} from "./events";
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
  reviewMode: boolean;
}

const MAX_FIELDS_TO_FILL = 40;

class StoppedError extends Error {
  constructor() {
    super("Run stopped by user");
    this.name = "StoppedError";
  }
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

function bail(runId: string) {
  if (isStopRequested(runId)) throw new StoppedError();
}

export async function runApplication(args: RunArgs): Promise<void> {
  const { runId, resume, resumePdfBase64, jobUrl, ats, provider, reviewMode } = args;
  const adapter = ADAPTERS[ats];

  let session: Awaited<ReturnType<typeof createSession>> | null = null;
  let stagehand: Stagehand | null = null;
  let resumePdfPath: string | null = null;

  try {
    const { modelName, apiKey } = resolveStagehandModel(provider);
    emit(
      runId,
      "started",
      `Starting application for ${ats.toUpperCase()} posting (using ${modelName})`,
      { provider, modelName, reviewMode },
    );

    session = await createSession();
    bail(runId);
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
    bail(runId);

    updateMeta(runId, { status: "navigating" });
    emit(runId, "navigated", `Navigating to ${new URL(jobUrl).hostname}`);
    const page = stagehand.context.activePage();
    if (!page) throw new Error("Stagehand failed to create a page");
    await page.goto(jobUrl, { waitUntil: "load", timeoutMs: 30_000 });
    bail(runId);

    // Wait for the form to hydrate — Ashby is fully SPA, Greenhouse partially.
    await page
      .waitForSelector(
        'form, [role="form"], input[type="email"], input[type="file"]',
        { state: "attached", timeout: 10_000 },
      )
      .catch(() => {
        // best-effort; extract will still try
      });

    emit(runId, "navigated", "Page loaded — reading form");

    const form = await adapter.extract(stagehand);
    bail(runId);
    updateMeta(runId, { company: form.company, status: "filling" });
    emit(runId, "form_extracted", `Detected ${form.fields.length} fields at ${form.company}`, {
      company: form.company,
      fieldCount: form.fields.length,
      fields: form.fields.map((f) => ({ label: f.label, type: f.type, required: f.required })),
    });

    resumePdfPath = await writeResumePdfToTemp(resumePdfBase64, runId);

    const fillable = form.fields.filter((f) => f.type !== "file").slice(0, MAX_FIELDS_TO_FILL);
    if (form.fields.filter((f) => f.type !== "file").length > MAX_FIELDS_TO_FILL) {
      emit(
        runId,
        "error",
        `Form has more than ${MAX_FIELDS_TO_FILL} fields — capping to protect cost`,
      );
    }

    for (const field of fillable) {
      bail(runId);
      try {
        const answer = await mapField(field, resume, jobUrl);
        if (!answer.value) {
          emit(runId, "field_filled", `Skipped ${field.label} (no value)`, {
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
        if (err instanceof StoppedError) throw err;
        emit(runId, "error", `Failed to fill ${field.label}: ${(err as Error).message}`, {
          label: field.label,
        });
      }
    }

    if (form.resumeFieldLabel) {
      bail(runId);
      const ok = await adapter.upload(stagehand, resumePdfPath);
      emit(
        runId,
        "file_uploaded",
        ok ? `Uploaded resume.pdf to ${form.resumeFieldLabel}` : "Resume upload failed",
        { ok },
      );
    }

    if (reviewMode) {
      updateMeta(runId, { status: "awaiting_review" });
      emit(
        runId,
        "awaiting_review",
        "Form filled — review and click 'Submit for real' in the dashboard to send",
      );
      const submitted = await waitForSubmitOrStop(runId, 5 * 60 * 1000);
      bail(runId);
      if (!submitted) {
        emit(runId, "stopped", "No submit action within 5 minutes — stopping");
        finishRun(runId, "stopped");
        return;
      }
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
    if (err instanceof StoppedError) {
      emit(runId, "stopped", "Run stopped by user");
      finishRun(runId, "stopped");
    } else {
      const message = err instanceof Error ? err.message : String(err);
      emit(runId, "error", message);
      finishRun(runId, "failed", message);
    }
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
    if (resumePdfPath) {
      try {
        await rm(join(tmpdir(), "autoapply", runId), { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  }
}

async function waitForSubmitOrStop(runId: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isStopRequested(runId)) return false;
    if (isSubmitRequested(runId)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function fillSingleField(stagehand: Stagehand, field: FormField, value: string): Promise<void> {
  const page = stagehand.context.activePage();
  if (!page) throw new Error("No active page");

  if (
    field.type === "text" ||
    field.type === "email" ||
    field.type === "phone" ||
    field.type === "url" ||
    field.type === "textarea"
  ) {
    const ok = await tryFillByLabel(stagehand, field.label, value);
    if (ok) return;
  }

  if (field.type === "select" && field.options && field.options.length > 0) {
    const ok = await trySelectByLabel(stagehand, field.label, value);
    if (ok) return;
  }

  await stagehand.act(`Fill the "${field.label}" field with: ${value}`);
}

function xpathLiteral(s: string): string {
  // Build an XPath string literal that handles both single and double quotes safely.
  if (!s.includes("'")) return `'${s}'`;
  if (!s.includes('"')) return `"${s}"`;
  const parts = s.split("'").map((p) => `'${p}'`);
  return `concat(${parts.join(",\"'\",")})`;
}

async function tryFillByLabel(stagehand: Stagehand, label: string, value: string): Promise<boolean> {
  const page = stagehand.context.activePage();
  if (!page) return false;
  const trimmed = label.replace(/\s*\*\s*$/, "").trim(); // drop trailing "*"
  const lit = xpathLiteral(trimmed);
  const candidates = [
    // <label for="...">Label</label>... matched input/textarea by `for`
    `xpath=//label[normalize-space()=${lit}]/@for/following::*[@id=string(.)][1]`,
    // Input nested inside the label
    `xpath=//label[normalize-space()=${lit}]//input | //label[normalize-space()=${lit}]//textarea`,
    // Input immediately following the label
    `xpath=//label[normalize-space()=${lit}]/following::*[self::input or self::textarea][1]`,
    // aria-label exact-ish match
    `input[aria-label="${trimmed.replace(/"/g, '\\"')}" i]`,
    `textarea[aria-label="${trimmed.replace(/"/g, '\\"')}" i]`,
    `input[placeholder*="${trimmed.replace(/"/g, '\\"')}" i]`,
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
}

async function trySelectByLabel(
  stagehand: Stagehand,
  label: string,
  value: string,
): Promise<boolean> {
  const page = stagehand.context.activePage();
  if (!page) return false;
  const trimmed = label.replace(/\s*\*\s*$/, "").trim();
  const lit = xpathLiteral(trimmed);
  const selectXPaths = [
    `xpath=//label[normalize-space()=${lit}]/following::select[1]`,
    `xpath=//label[normalize-space()=${lit}]//select`,
  ];
  for (const sel of selectXPaths) {
    try {
      const loc = page.locator(sel).first();
      if ((await loc.count()) > 0) {
        await loc.selectOption(value);
        return true;
      }
    } catch {
      // try next
    }
  }
  return false;
}

function redact(value: string): string {
  if (value.length <= 4) return value;
  if (value.includes("@")) {
    const [user, domain] = value.split("@");
    const [domainName, ...rest] = domain.split(".");
    const tld = rest.length > 0 ? `.${rest.join(".")}` : "";
    return `${user.slice(0, 2)}***@${domainName.slice(0, 1)}***${tld}`;
  }
  if (/^https?:/i.test(value)) {
    try {
      const u = new URL(value);
      return `${u.hostname}/…`;
    } catch {
      // fall through
    }
  }
  if (value.length > 60) return value.slice(0, 60) + "…";
  return value;
}

export function newRunId(): string {
  return randomUUID();
}
