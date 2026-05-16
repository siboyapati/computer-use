import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { AgentEvent, AgentEventKind, RunMetadata } from "./types";

interface RunRecord {
  meta: RunMetadata;
  emitter: EventEmitter;
  log: AgentEvent[];
  control: {
    stopRequested: boolean;
    submitRequested: boolean;
  };
}

const runs = new Map<string, RunRecord>();

let pruneTimer: NodeJS.Timeout | null = null;
function ensurePruneScheduled() {
  if (pruneTimer) return;
  pruneTimer = setInterval(() => pruneOldRuns(), 1000 * 60 * 5);
  // Unref so the timer doesn't keep the process alive during tests / scripts
  if (typeof pruneTimer.unref === "function") pruneTimer.unref();
}

export function createRun(meta: Omit<RunMetadata, "startedAt" | "finishedAt" | "screenshotUrl" | "error" | "status" | "liveUrl" | "company"> & Partial<RunMetadata>): RunRecord {
  ensurePruneScheduled();
  const fullMeta: RunMetadata = {
    liveUrl: null,
    status: "starting",
    company: null,
    startedAt: Date.now(),
    finishedAt: null,
    screenshotUrl: null,
    error: null,
    ...meta,
  };
  const emitter = new EventEmitter();
  emitter.setMaxListeners(50);
  const record: RunRecord = {
    meta: fullMeta,
    emitter,
    log: [],
    control: { stopRequested: false, submitRequested: false },
  };
  runs.set(meta.runId, record);
  return record;
}

export function getRun(runId: string): RunRecord | undefined {
  return runs.get(runId);
}

export function emit(
  runId: string,
  kind: AgentEventKind,
  message: string,
  data?: Record<string, unknown>,
): AgentEvent {
  const record = runs.get(runId);
  const event: AgentEvent = {
    id: randomUUID(),
    runId,
    kind,
    ts: Date.now(),
    message,
    data,
  };
  if (record) {
    record.log.push(event);
    record.emitter.emit("event", event);
  }
  return event;
}

export function updateMeta(runId: string, patch: Partial<RunMetadata>): void {
  const record = runs.get(runId);
  if (!record) return;
  Object.assign(record.meta, patch);
}

export function finishRun(runId: string, finalStatus: "submitted" | "failed" | "stopped", error?: string): void {
  const record = runs.get(runId);
  if (!record) return;
  record.meta.status = finalStatus;
  record.meta.finishedAt = Date.now();
  if (error) record.meta.error = error;
  record.emitter.emit("done");
}

export function requestStop(runId: string): boolean {
  const record = runs.get(runId);
  if (!record) return false;
  record.control.stopRequested = true;
  return true;
}

export function requestSubmit(runId: string): boolean {
  const record = runs.get(runId);
  if (!record) return false;
  record.control.submitRequested = true;
  return true;
}

export function isStopRequested(runId: string): boolean {
  return runs.get(runId)?.control.stopRequested ?? false;
}

export function isSubmitRequested(runId: string): boolean {
  return runs.get(runId)?.control.submitRequested ?? false;
}

export function pruneOldRuns(olderThanMs = 1000 * 60 * 30): void {
  const cutoff = Date.now() - olderThanMs;
  for (const [id, record] of runs.entries()) {
    if (record.meta.finishedAt && record.meta.finishedAt < cutoff) {
      runs.delete(id);
    }
  }
}
