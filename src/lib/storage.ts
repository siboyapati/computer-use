"use client";

import type { ATS, Resume, RunMetadata, RunStatus } from "./agent/types";

const KEY_RESUME = "autoapply.resume.v1";
const KEY_HISTORY = "autoapply.history.v1";
const KEY_ACTIVE_RUN = "autoapply.activeRun.v1";
const MAX_HISTORY = 5;
const MAX_PDF_BYTES = 6 * 1024 * 1024; // ~6 MB base64 ≈ 4.5 MB raw
const ACTIVE_RUN_MAX_AGE_MS = 1000 * 60 * 60 * 2;

export interface StoredResume {
  resume: Resume;
  pdfBase64: string;
  fileName: string;
  storedAt: number;
}

export interface HistoryItem {
  runId: string;
  company: string | null;
  jobUrl: string;
  status: "submitted" | "failed" | "stopped";
  ats: ATS;
  screenshotUrl: string | null;
  finishedAt: number;
}

export interface ActiveRun {
  runId: string;
  jobUrl: string;
  ats: ATS;
  liveUrl: string | null;
  company: string | null;
  status: RunStatus;
  startedAt: number;
  updatedAt: number;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadResume(): StoredResume | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(KEY_RESUME);
    if (!raw) return null;
    return JSON.parse(raw) as StoredResume;
  } catch {
    return null;
  }
}

export function saveResume(data: Omit<StoredResume, "storedAt">): void {
  if (!isBrowser()) return;
  try {
    if (data.pdfBase64.length > MAX_PDF_BYTES) {
      // Too large for localStorage (5–10 MB quota). Just skip persistence; the
      // session still works, the user just has to re-drop on next visit.
      return;
    }
    const payload: StoredResume = { ...data, storedAt: Date.now() };
    window.localStorage.setItem(KEY_RESUME, JSON.stringify(payload));
  } catch {
    // QuotaExceededError or JSON failure — silently skip
  }
}

export function clearResume(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(KEY_RESUME);
  } catch {
    // ignore
  }
}

export function loadHistory(): HistoryItem[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(KEY_HISTORY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as HistoryItem[];
  } catch {
    return [];
  }
}

export function recordRun(meta: RunMetadata, ats: HistoryItem["ats"]): void {
  if (!isBrowser()) return;
  if (meta.status !== "submitted" && meta.status !== "failed" && meta.status !== "stopped") return;
  try {
    const current = loadHistory();
    const next: HistoryItem = {
      runId: meta.runId,
      company: meta.company,
      jobUrl: meta.jobUrl,
      status: meta.status,
      ats,
      screenshotUrl: meta.screenshotUrl,
      finishedAt: meta.finishedAt ?? Date.now(),
    };
    // dedupe by runId
    const filtered = current.filter((h) => h.runId !== next.runId);
    const merged = [next, ...filtered].slice(0, MAX_HISTORY);
    window.localStorage.setItem(KEY_HISTORY, JSON.stringify(merged));
  } catch {
    // ignore
  }
}

export function loadActiveRun(): ActiveRun | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(KEY_ACTIVE_RUN);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveRun;
    if (!parsed?.runId || !parsed.jobUrl || !parsed.ats || !parsed.status) return null;
    if (isTerminalRunStatus(parsed.status)) return null;
    if (Date.now() - (parsed.updatedAt || parsed.startedAt || 0) > ACTIVE_RUN_MAX_AGE_MS) {
      clearActiveRun();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveActiveRun(run: ActiveRun): void {
  if (!isBrowser()) return;
  if (isTerminalRunStatus(run.status)) {
    clearActiveRun();
    return;
  }
  try {
    window.localStorage.setItem(
      KEY_ACTIVE_RUN,
      JSON.stringify({ ...run, updatedAt: Date.now() }),
    );
  } catch {
    // ignore
  }
}

export function clearActiveRun(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(KEY_ACTIVE_RUN);
  } catch {
    // ignore
  }
}

export function activeRunFromMeta(meta: RunMetadata): ActiveRun {
  return {
    runId: meta.runId,
    jobUrl: meta.jobUrl,
    ats: meta.ats,
    liveUrl: meta.liveUrl,
    company: meta.company,
    status: meta.status,
    startedAt: meta.startedAt,
    updatedAt: Date.now(),
  };
}

export function isTerminalRunStatus(status: RunStatus): boolean {
  return status === "submitted" || status === "failed" || status === "stopped";
}

export function clearHistory(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(KEY_HISTORY);
  } catch {
    // ignore
  }
}
