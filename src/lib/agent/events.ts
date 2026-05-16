import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { AgentEvent, AgentEventKind, RunMetadata } from "./types";

interface RunRecord {
  meta: RunMetadata;
  emitter: EventEmitter;
  log: AgentEvent[];
}

const runs = new Map<string, RunRecord>();

export function createRun(meta: Omit<RunMetadata, "startedAt" | "finishedAt" | "screenshotUrl" | "error" | "status" | "liveUrl" | "company"> & Partial<RunMetadata>): RunRecord {
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
  const record: RunRecord = { meta: fullMeta, emitter, log: [] };
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

export function finishRun(runId: string, finalStatus: "submitted" | "failed", error?: string): void {
  const record = runs.get(runId);
  if (!record) return;
  record.meta.status = finalStatus;
  record.meta.finishedAt = Date.now();
  if (error) record.meta.error = error;
  record.emitter.emit("done");
}

export function pruneOldRuns(olderThanMs = 1000 * 60 * 30): void {
  const cutoff = Date.now() - olderThanMs;
  for (const [id, record] of runs.entries()) {
    if (record.meta.finishedAt && record.meta.finishedAt < cutoff) {
      runs.delete(id);
    }
  }
}
