"use client";

import type { Resume, RunMetadata } from "./agent/types";

const KEY_RESUME = "autoapply.resume.v1";
const KEY_HISTORY = "autoapply.history.v1";
const MAX_HISTORY = 5;
const MAX_PDF_BYTES = 6 * 1024 * 1024; // ~6 MB base64 ≈ 4.5 MB raw

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
  ats: "lever" | "greenhouse" | "ashby";
  screenshotUrl: string | null;
  finishedAt: number;
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
  if (meta.status !== "submitted" && meta.status !== "failed") return;
  try {
    const current = loadHistory();
    const next: HistoryItem = {
      runId: meta.runId,
      company: meta.company,
      jobUrl: meta.jobUrl,
      status: meta.status === "submitted" ? "submitted" : "failed",
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

export function clearHistory(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(KEY_HISTORY);
  } catch {
    // ignore
  }
}
