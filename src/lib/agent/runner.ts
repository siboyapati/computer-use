/**
 * Agent runner — the orchestrator that turns a parsed résumé + job URL
 * into a real submitted application.
 *
 * High-level flow (see docs/features/agent-runner.md for the full diagram):
 *   1. Pick the LLM provider (Claude Haiku 4.5 default, Gemini 3 Flash opt-in).
 *   2. Provision a Steel.dev cloud Chromium session.
 *   3. Connect Stagehand v3 via CDP.
 *   4. Dispatch to the per-ATS adapter (Lever / Greenhouse / Ashby) to
 *      extract the form schema.
 *   5. Fill every field via mapField — deterministic → EEO privacy guard →
 *      profile extras/saved answers → LLM fallback. File uploads use
 *      Playwright's setInputFiles directly (no LLM involvement).
 *   6. Optionally pause for human review (default ON via reviewMode).
 *   7. Click Submit. Capture screenshot. Clean up.
 *
 * Every step emits an AgentEvent to the in-memory pub/sub keyed by runId.
 * The SSE endpoint (api/events/[runId]) pipes those events to the live UI.
 *
 * Cancellation: `bail(runId)` is called at every step boundary and throws
 * a StoppedError if the user clicked Stop. Mid-`stagehand.act()` cancellation
 * isn't supported by Stagehand v3, so Stop can take up to ~30s to take effect.
 *
 * Cost guards: MAX_FIELDS_TO_FILL caps the per-run field count. The
 * field-mapper's LLM calls use prompt caching on the résumé block so
 * 20 custom questions on the same form pay the résumé cost once.
 */
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
  drainFillRequests,
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
import {
  normalizeKeys,
  resolveAnthropic,
  resolveGoogle,
  resolveSteel,
  type UserKeys,
} from "./keys";
import type { UserProfile } from "./profile-types";

interface RunArgs {
  runId: string;
  resume: Resume;
  resumePdfBase64: string;
  jobUrl: string;
  ats: ATS;
  provider: LLMProvider;
  reviewMode: boolean;
  /**
   * Optional per-request API key overrides. When present, used instead of
   * the server's env vars. Never stored.
   */
  userKeys?: UserKeys;
  /**
   * Optional user profile (extras + learnedAnswers). The field-mapper
   * consults these between the deterministic résumé tier and the LLM
   * fallback. See profile-types.ts + features/field-mapping.md.
   */
  profile?: UserProfile;
}

const MAX_FIELDS_TO_FILL = 40;

class StoppedError extends Error {
  constructor() {
    super("Run stopped by user");
    this.name = "StoppedError";
  }
}

/**
 * Resolve which model + API key to hand Stagehand for this run.
 *
 * For each provider, prefer the user-supplied key (`userKeys`) over the
 * server env var. Both Claude Haiku 4.5 and Gemini 3 Flash are in
 * Stagehand v3's `AVAILABLE_CUA_MODELS` list, so they can both drive the
 * agent. We use Stagehand's act/extract path (more deterministic + cheaper)
 * rather than the autonomous `stagehand.agent()` CUA loop.
 */
function resolveStagehandModel(
  provider: LLMProvider,
  userKeys?: UserKeys,
): { modelName: string; apiKey: string } {
  const keys = normalizeKeys(userKeys);
  if (provider === "google") {
    const apiKey = resolveGoogle(keys);
    if (!apiKey) {
      throw new Error(
        "Gemini API key not configured. Add it on the Settings page or set GOOGLE_GENERATIVE_AI_API_KEY on the server.",
      );
    }
    const model = process.env.GEMINI_MODEL || "gemini-3-flash-preview";
    return { modelName: `google/${model}`, apiKey };
  }
  const apiKey = resolveAnthropic(keys);
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
  const { runId, resume, resumePdfBase64, jobUrl, ats, provider, reviewMode, userKeys, profile } = args;
  const adapter = ADAPTERS[ats];
  const normalizedKeys = normalizeKeys(userKeys);

  let session: Awaited<ReturnType<typeof createSession>> | null = null;
  let stagehand: Stagehand | null = null;
  let resumePdfPath: string | null = null;
  let sessionApiKey: string | undefined;
  // Track required fields the agent had no answer for. Surfaced in the
  // live UI via `meta.skippedRequired` so the user knows what to manually
  // fill before clicking "Submit for real".
  const skippedRequired: string[] = [];

  try {
    // Resolve keys inside the try block so missing-key failures are reported
    // through the normal run error path instead of becoming unhandled
    // background promise rejections.
    const anthropicKey = resolveAnthropic(normalizedKeys);
    const steelKey = resolveSteel(normalizedKeys);
    sessionApiKey = steelKey;
    const { modelName, apiKey } = resolveStagehandModel(provider, normalizedKeys);
    emit(
      runId,
      "started",
      `Starting application for ${ats.toUpperCase()} posting (using ${modelName})`,
      { provider, modelName, reviewMode },
    );

    session = await createSession(steelKey);
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
        const answer = await mapField(field, resume, jobUrl, anthropicKey, profile);
        if (!answer.value) {
          // The agent had no answer (résumé silent on this field + LLM
          // fallback returned ""). For required fields, track them so the
          // user can manually fix in review mode.
          if (field.required) {
            skippedRequired.push(field.label);
            updateMeta(runId, { skippedRequired: [...skippedRequired] });
          }
          emit(runId, "field_filled", `Skipped ${field.label} (no value)`, {
            label: field.label,
            skipped: true,
            required: field.required,
            reasoning: answer.reasoning,
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
      const skippedNote = skippedRequired.length
        ? ` ${skippedRequired.length} required field${skippedRequired.length === 1 ? "" : "s"} need your input first — fix in the live browser, then submit.`
        : "";
      emit(
        runId,
        "awaiting_review",
        `Form filled — review and click 'Submit for real' to send.${skippedNote}`,
        { skippedRequired: [...skippedRequired] },
      );
      const submitted = await waitForSubmitOrStop(runId, 5 * 60 * 1000, stagehand);
      bail(runId);
      if (!submitted) {
        emit(runId, "stopped", "No submit action within 5 minutes — stopping");
        finishRun(runId, "stopped");
        return;
      }
    }

    // Last chance for the user to abort. A stop click during the
    // awaiting_review pause is honored above; this guards the gap between
    // "Submit for real" and the actual `act("Click submit")`.
    bail(runId);

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
      await releaseSession(session.id, sessionApiKey);
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

/**
 * Park the runner during the `awaiting_review` state. Three exit
 * conditions:
 *   - User clicked Submit for real        → returns true
 *   - User clicked Stop, or 5 min elapsed → returns false
 *   - User queued a "Save & fill" instruction → we DON'T exit;
 *     we drain + execute the fill via Stagehand, emit a field_filled
 *     event, then keep waiting.
 */
async function waitForSubmitOrStop(
  runId: string,
  timeoutMs: number,
  stagehand: Stagehand,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isStopRequested(runId)) return false;
    if (isSubmitRequested(runId)) return true;

    // Drain any pending "Save & fill" requests submitted by the user
    // from the live UI. Each one is executed via stagehand.act() so the
    // field gets filled in the visible cloud browser.
    const fills = drainFillRequests(runId);
    for (const { label, value } of fills) {
      try {
        await stagehand.act(`Fill the "${label}" field with: ${value}`);
        emit(runId, "field_filled", `Filled ${label} (you)`, {
          label,
          value: redact(value),
          reasoning: "user-provided during review",
        });
      } catch (err) {
        emit(
          runId,
          "error",
          `Couldn't fill ${label}: ${err instanceof Error ? err.message : String(err)}`,
          { label },
        );
      }
    }

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

/**
 * Resolve a label string to an input/textarea and fill it.
 *
 * The selector chain runs cheapest-first: cross-element `for=`/`id`
 * pairing, then nested input, then following-sibling, then aria/placeholder
 * fallbacks. The first selector that matches at least one element wins.
 *
 * Returns `false` if nothing matched — the runner then falls back to
 * `stagehand.act("Fill the X field with: Y")`, which uses the LLM.
 */
async function tryFillByLabel(stagehand: Stagehand, label: string, value: string): Promise<boolean> {
  const page = stagehand.context.activePage();
  if (!page) return false;
  const trimmed = label.replace(/\s*\*\s*$/, "").trim(); // drop trailing "*"
  const lit = xpathLiteral(trimmed);
  const candidates = [
    // <label for="X">Label</label> + <input id="X"> — looks up the id via
    // the label's `for` attribute. Note: chaining `following::` off
    // `/@for` would be invalid XPath 1.0 (you can't continue an axis from
    // an attribute node), so we use a predicate-based lookup instead.
    `xpath=//*[@id=//label[normalize-space()=${lit}]/@for]`,
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

/**
 * Strip PII from a value before it ships over the SSE stream.
 *
 * The event log is in-memory but emitted to whoever holds the runId. Email
 * addresses, phone numbers, and full URLs are the obvious PII; long
 * free-text answers get truncated for UI sanity.
 */
function redact(value: string): string {
  if (value.length <= 4) return value;
  if (value.includes("@")) {
    const [user, domain] = value.split("@");
    const [domainName, ...rest] = domain.split(".");
    const tld = rest.length > 0 ? `.${rest.join(".")}` : "";
    return `${user.slice(0, 2)}***@${domainName.slice(0, 1)}***${tld}`;
  }
  // Phone numbers: 7+ digits with optional separators and country code
  if (/^[\d\s().+-]{7,}$/.test(value) && /\d{4,}/.test(value)) {
    const digitsOnly = value.replace(/\D/g, "");
    if (digitsOnly.length >= 7) {
      return `${digitsOnly.slice(0, 3)}-***-${digitsOnly.slice(-2)}`;
    }
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
