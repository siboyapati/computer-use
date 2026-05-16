"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowLeft, ExternalLink, Loader2, Sparkles, Square, Send } from "lucide-react";
import Image from "next/image";
import { EventLog } from "./event-log";
import { toast } from "sonner";
import type { AgentEvent, RunMetadata, RunStatus } from "@/lib/agent/types";

interface Props {
  runId: string;
  liveUrl: string | null;
  events: AgentEvent[];
  meta: RunMetadata | null;
  onRestart: () => void;
  onApplyAnother: () => void;
}

const PHASES: Array<{ key: RunStatus; label: string }> = [
  { key: "starting", label: "Booting browser" },
  { key: "navigating", label: "Reading the form" },
  { key: "filling", label: "Filling fields" },
  { key: "submitting", label: "Submitting" },
  { key: "submitted", label: "Done" },
];

export function LiveRun({ runId, liveUrl, events, meta, onRestart, onApplyAnother }: Props) {
  const status: RunStatus = meta?.status ?? "starting";
  const isDone = status === "submitted" || status === "failed" || status === "stopped";
  const [showCelebration, setShowCelebration] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    if (status === "submitted") {
      const t = setTimeout(() => setShowCelebration(true), 400);
      return () => clearTimeout(t);
    }
  }, [status]);

  async function handleStop() {
    if (stopping || isDone) return;
    setStopping(true);
    try {
      await fetch(`/api/stop/${runId}`, { method: "POST" });
      toast.message("Stopping…", { description: "The agent will halt at the next step." });
    } catch {
      toast.error("Couldn't reach the server to stop the run");
    } finally {
      setStopping(false);
    }
  }

  async function handleSubmitNow() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/submit-now/${runId}`, { method: "POST" });
      if (!res.ok) throw new Error("Server rejected the submit request");
      toast.message("Submitting…", { description: "Watch the live browser." });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't submit");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ type: "spring", stiffness: 220, damping: 28 }}
      className="mx-auto flex h-[calc(100vh-4rem)] w-full max-w-[1700px] flex-col gap-4 px-4 pt-6 pb-6 md:px-8"
    >
      <Header
        meta={meta}
        status={status}
        isDone={isDone}
        stopping={stopping}
        submitting={submitting}
        onRestart={onApplyAnother}
        onStop={handleStop}
        onSubmitNow={handleSubmitNow}
      />

      <PhaseStrip status={status} />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[1.65fr_1fr]">
        <BrowserPane liveUrl={liveUrl} status={status} />
        <LogPane events={events} status={status} />
      </div>

      <AnimatePresence>
        {showCelebration && status === "submitted" && (
          <CelebrationModal
            meta={meta}
            onClose={() => setShowCelebration(false)}
            onRestart={() => {
              setShowCelebration(false);
              onApplyAnother();
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isDone && status === "failed" && (
          <FailedBanner message={meta?.error ?? "Run failed"} onRestart={onRestart} />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function Header({
  meta,
  status,
  isDone,
  stopping,
  submitting,
  onRestart,
  onStop,
  onSubmitNow,
}: {
  meta: RunMetadata | null;
  status: RunStatus;
  isDone: boolean;
  stopping: boolean;
  submitting: boolean;
  onRestart: () => void;
  onStop: () => void;
  onSubmitNow: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <button
        type="button"
        onClick={onRestart}
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/40 px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="size-3" />
        New application
      </button>
      <div className="flex items-center gap-2">
        {meta?.company && (
          <div className="hidden text-sm md:block">
            <span className="text-muted-foreground">Applying to</span>{" "}
            <span className="font-medium text-foreground">{meta.company}</span>
          </div>
        )}
        {status === "awaiting_review" && (
          <button
            type="button"
            onClick={onSubmitNow}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
            Submit for real
          </button>
        )}
        {!isDone && (
          <button
            type="button"
            onClick={onStop}
            disabled={stopping}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/40 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-destructive/40 hover:text-destructive disabled:opacity-50"
          >
            {stopping ? <Loader2 className="size-3 animate-spin" /> : <Square className="size-3" />}
            Stop
          </button>
        )}
        <StatusPill status={status} />
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: RunStatus }) {
  const text: Record<RunStatus, string> = {
    starting: "Starting",
    navigating: "Reading",
    filling: "Filling",
    awaiting_review: "Awaiting review",
    submitting: "Submitting",
    submitted: "Submitted",
    failed: "Failed",
    stopped: "Stopped",
  };
  let tone = "bg-card/50 text-foreground/85 border-border";
  if (status === "submitted") tone = "bg-primary/20 text-primary border-primary/40";
  else if (status === "failed") tone = "bg-destructive/20 text-destructive border-destructive/40";
  else if (status === "stopped") tone = "bg-muted text-muted-foreground border-border";
  else if (status === "awaiting_review") tone = "bg-amber-500/15 text-amber-300 border-amber-500/30";
  const spinning = !["submitted", "failed", "stopped", "awaiting_review"].includes(status);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.18em] ${tone}`}>
      {spinning && <Loader2 className="size-3 animate-spin" />}
      {text[status]}
    </span>
  );
}

function PhaseStrip({ status }: { status: RunStatus }) {
  const failed = status === "failed" || status === "stopped";
  // Map awaiting_review to the "filling" stage so it doesn't jump backwards
  const effectiveStatus: RunStatus =
    status === "awaiting_review" ? "filling" : status;
  let idx = PHASES.findIndex((p) => p.key === effectiveStatus);
  if (failed) idx = PHASES.length; // light up everything, then color differently
  return (
    <div className="flex items-center gap-2">
      {PHASES.map((p, i) => {
        const active = i <= idx;
        const current = i === idx && !failed;
        const color = failed
          ? "bg-destructive"
          : active
            ? "bg-primary"
            : "bg-muted-foreground/30";
        const lineColor = failed
          ? "bg-destructive/40"
          : active
            ? "bg-primary/40"
            : "bg-border";
        return (
          <div key={p.key} className="flex flex-1 items-center gap-2">
            <div className="flex items-center gap-2">
              <span className={`size-1.5 rounded-full transition-colors ${color}`} />
              <span
                className={`text-[10px] uppercase tracking-[0.16em] transition-colors ${
                  failed
                    ? "text-destructive/80"
                    : current
                      ? "text-foreground"
                      : active
                        ? "text-foreground/70"
                        : "text-muted-foreground/50"
                }`}
              >
                {p.label}
              </span>
            </div>
            {i < PHASES.length - 1 && (
              <span className={`h-px flex-1 transition-colors ${lineColor}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function BrowserPane({ liveUrl, status }: { liveUrl: string | null; status: RunStatus }) {
  const acting = status === "filling" || status === "submitting";
  return (
    <div
      className={`relative flex min-h-0 flex-col overflow-hidden rounded-3xl border bg-black/60 ${
        acting ? "border-primary/40" : "border-border"
      } transition-colors`}
    >
      {acting && (
        <div className="pointer-events-none absolute inset-0 rounded-3xl ring-1 ring-primary/30 [box-shadow:0_0_60px_rgba(212,255,80,0.18)_inset] animate-pulse" />
      )}
      <BrowserChrome url={liveUrl} />
      <div className="relative flex-1">
        {liveUrl ? (
          <iframe
            src={liveUrl}
            className="absolute inset-0 h-full w-full"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
            title="Live browser session"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="size-5 animate-spin text-primary" />
            <span className="text-sm">Provisioning cloud browser…</span>
            <span className="text-xs text-muted-foreground/60">This usually takes 5–15 seconds.</span>
          </div>
        )}
      </div>
    </div>
  );
}

function BrowserChrome({ url }: { url: string | null }) {
  return (
    <div className="flex items-center gap-2 border-b border-border/60 bg-card/40 px-3 py-2 backdrop-blur">
      <div className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-full bg-red-400/70" />
        <span className="size-2.5 rounded-full bg-amber-400/70" />
        <span className="size-2.5 rounded-full bg-emerald-400/70" />
      </div>
      <div className="ml-2 flex-1 truncate rounded-md border border-border/40 bg-background/30 px-3 py-1 font-mono text-[11px] text-muted-foreground">
        live cloud session · {url ? new URL(url).hostname : "connecting…"}
      </div>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition hover:text-foreground"
        >
          Open <ExternalLink className="size-3" />
        </a>
      )}
    </div>
  );
}

function LogPane({ events, status }: { events: AgentEvent[]; status: RunStatus }) {
  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-border bg-card/30 backdrop-blur">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          <Sparkles className="size-3 text-primary" />
          Agent stream
        </div>
        <div className="text-[10px] text-muted-foreground/60">{events.length} events</div>
      </div>
      <div className="min-h-0 flex-1">
        <EventLog events={events} />
      </div>
      {status === "awaiting_review" ? (
        <div className="border-t border-amber-500/30 bg-amber-500/5 px-4 py-2 font-mono text-[11px] text-amber-200/90">
          ⏸ paused for review — click <span className="font-semibold">Submit for real</span> above
        </div>
      ) : status !== "submitted" && status !== "failed" && status !== "stopped" ? (
        <div className="border-t border-border/60 px-4 py-2 font-mono text-[11px] text-muted-foreground">
          <span className="inline-block animate-pulse">▍</span> thinking
        </div>
      ) : null}
    </div>
  );
}

function CelebrationModal({
  meta,
  onClose,
  onRestart,
}: {
  meta: RunMetadata | null;
  onClose: () => void;
  onRestart: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/85 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97 }}
        transition={{ type: "spring", stiffness: 280, damping: 28 }}
        onClick={(e) => e.stopPropagation()}
        className="glass relative w-full max-w-2xl overflow-hidden rounded-3xl p-7"
      >
        <Confetti />
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <Sparkles className="size-5" />
          </div>
          <div>
            <div className="font-display text-2xl text-foreground">
              Submitted{meta?.company ? ` to ${meta.company}` : ""}.
            </div>
            <div className="text-sm text-muted-foreground">
              Your application is in. Receipt below.
            </div>
          </div>
        </div>

        {meta?.screenshotUrl && (
          <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-black/30">
            <Image
              src={meta.screenshotUrl}
              alt="Submission receipt"
              width={1440}
              height={900}
              unoptimized
              className="h-72 w-full object-cover object-top"
            />
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-xl border border-border bg-card/40 px-4 py-2 text-sm text-foreground/80 transition hover:text-foreground"
          >
            Keep looking
          </button>
          <button
            onClick={onRestart}
            className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            Apply to another
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Confetti() {
  // Lightweight CSS-only confetti. No deps.
  const pieces = Array.from({ length: 24 }, (_, i) => i);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-4 h-24 overflow-visible">
      {pieces.map((i) => (
        <span
          key={i}
          className="absolute top-0 block h-1.5 w-1.5 rounded-sm"
          style={{
            left: `${(i / pieces.length) * 100}%`,
            background: i % 3 === 0 ? "var(--primary)" : i % 3 === 1 ? "#7ee2ff" : "#ffd87e",
            animation: `confetti-fall 1.6s ${i * 0.04}s ease-out forwards`,
            transform: "translateY(-20px) rotate(0deg)",
            opacity: 0,
          }}
        />
      ))}
      <style>{`@keyframes confetti-fall { 0% { transform: translateY(-20px) rotate(0deg); opacity: 0; } 20% { opacity: 1; } 100% { transform: translateY(140px) rotate(540deg); opacity: 0; } }`}</style>
    </div>
  );
}

function FailedBanner({ message, onRestart }: { message: string; onRestart: () => void }) {
  return (
    <motion.div
      initial={{ y: 30, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 30, opacity: 0 }}
      className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-2xl border border-destructive/40 bg-destructive/15 px-5 py-3 text-sm text-destructive shadow-2xl backdrop-blur"
    >
      <div className="font-medium">Run failed</div>
      <div className="text-destructive/85">{message}</div>
      <button
        onClick={onRestart}
        className="mt-2 rounded-md border border-destructive/40 px-3 py-1 text-xs text-destructive hover:bg-destructive/20"
      >
        Try again
      </button>
    </motion.div>
  );
}
