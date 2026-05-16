"use client";

import { useCallback, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  Activity,
  BrainCircuit,
  CheckCircle2,
  ExternalLink,
  FileCheck2,
  FileText,
  Gauge,
  Library,
  Loader2,
  MousePointerClick,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { RunHistoryStrip } from "./run-history";
import type { ActiveRun, HistoryItem, StoredResume } from "@/lib/storage";

interface Props {
  onParsed: (data: { resume: unknown; pdfBase64: string; fileName: string }) => void;
  onError: (message: string) => void;
  onUseSample: () => Promise<void>;
  storedResume: StoredResume | null;
  history: HistoryItem[];
  activeRun: ActiveRun | null;
  onOpenActiveRun: () => void;
  onDismissActiveRun: () => void;
  onUseStoredResume: () => void;
  onForgetStoredResume: () => void;
}

export function Landing({
  onParsed,
  onError,
  onUseSample,
  storedResume,
  history,
  activeRun,
  onOpenActiveRun,
  onDismissActiveRun,
  onUseStoredResume,
  onForgetStoredResume,
}: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sampling, setSampling] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Wraps the parent's onUseSample so the button can render its own
  // pending state without leaking sampling to other handlers.
  const handleSample = useCallback(async () => {
    if (sampling || busy) return;
    setSampling(true);
    try {
      await onUseSample();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't load sample résumé");
      setSampling(false);
    }
    // On success the page transitions away from Landing, so the component
    // unmounts and we don't need to flip sampling back to false.
  }, [sampling, busy, onUseSample, onError]);

  const handleFile = useCallback(
    async (file: File) => {
      if (busy) return;
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        onError("Please drop a PDF resume.");
        return;
      }
      setBusy(true);
      try {
        const form = new FormData();
        form.append("file", file);
        // If the user has configured an Anthropic key in Settings, attach
        // it as a multipart text field so the parser uses their account.
        // Loaded lazily here (not at module scope) so changes to Settings
        // take effect without a page refresh.
        const stored = (await import("@/lib/keys")).loadKeys();
        if (stored.anthropic) form.append("anthropicKey", stored.anthropic);
        const res = await fetch("/api/parse-resume", { method: "POST", body: form });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Parse failed (${res.status})`);
        }
        const body = await res.json();
        onParsed({ resume: body.resume, pdfBase64: body.pdfBase64, fileName: file.name });
      } catch (err) {
        onError(err instanceof Error ? err.message : "Failed to parse resume");
      } finally {
        setBusy(false);
      }
    },
    [busy, onError, onParsed],
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ type: "spring", stiffness: 220, damping: 28 }}
      className="mx-auto flex w-full max-w-6xl flex-col px-6 pt-24 pb-12"
    >
      <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="text-left">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1 text-xs uppercase tracking-[0.18em] text-muted-foreground shadow-card backdrop-blur">
            <Sparkles className="size-3 text-primary" />
            Live job application agent
          </div>

          <h1 className="font-display max-w-3xl text-balance text-6xl font-light leading-[1.02] text-foreground md:text-7xl">
            Apply with a live agent you can actually watch.
          </h1>

          <p className="mt-6 max-w-2xl text-balance text-lg leading-8 text-muted-foreground">
            Drop your résumé once, open a supported job, and AutoApply fills the real form in a
            cloud browser. Review mode stays on by default so the final submit remains yours.
          </p>

          <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <HeroMetric icon={<MousePointerClick className="size-4" />} value="1-click" label="from job pages" />
            <HeroMetric icon={<ShieldCheck className="size-4" />} value="Review" label="before submit" />
            <HeroMetric icon={<Library className="size-4" />} value="Memory" label="for repeat answers" />
          </div>
        </section>

        <section className="w-full">
          <div className="mb-3 flex items-center justify-between gap-3 text-xs uppercase tracking-[0.16em] text-muted-foreground">
            <span>Start here</span>
            <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-1 text-[10px] text-primary">
              PDF up to 5 MB
            </span>
          </div>
          <DropZone
            dragOver={dragOver}
            busy={busy}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) handleFile(f);
            }}
            onClick={() => inputRef.current?.click()}
          />
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />

          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground sm:justify-start"
          >
            {storedResume && !busy && (
              <>
                <button
                  type="button"
                  onClick={onUseStoredResume}
                  className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-primary transition hover:bg-primary/15"
                >
                  <RotateCcw className="size-3" />
                  Use last résumé ({storedResume.resume.personal.firstName}, {storedResume.fileName})
                </button>
                <button
                  type="button"
                  onClick={onForgetStoredResume}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-muted-foreground/70 hover:text-foreground"
                  aria-label="Forget stored résumé"
                >
                  <X className="size-3" />
                </button>
                <span className="text-muted-foreground/40">·</span>
              </>
            )}
            <button
              type="button"
              onClick={handleSample}
              disabled={sampling || busy}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-foreground/80 transition hover:border-primary/40 hover:text-foreground disabled:opacity-60"
            >
              {sampling ? <Loader2 className="size-3 animate-spin" /> : <Wand2 className="size-3" />}
              Try with sample résumé
            </button>
          </motion.div>
        </section>
      </div>

      {activeRun && (
        <ActiveRunBanner
          run={activeRun}
          onOpen={onOpenActiveRun}
          onDismiss={onDismissActiveRun}
        />
      )}

      <div className="mt-10 flex items-center gap-6 text-xs uppercase tracking-[0.18em] text-muted-foreground">
        <Supports name="Lever" />
        <Dot />
        <Supports name="Greenhouse" />
        <Dot />
        <Supports name="Ashby" />
      </div>

      <section className="mt-14 grid grid-cols-1 gap-3 md:grid-cols-3">
        <WorkflowStep
          icon={<FileCheck2 className="size-4" />}
          title="Parse once"
          copy="Structured résumé data, saved locally for the next application."
        />
        <WorkflowStep
          icon={<BrainCircuit className="size-4" />}
          title="Fill intelligently"
          copy="Resume matches, saved answers, company overrides, then model fallback."
        />
        <WorkflowStep
          icon={<Gauge className="size-4" />}
          title="Review faster"
          copy="Low-confidence answers and skipped required fields surface first."
        />
      </section>

      <section className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="flex flex-col justify-center">
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Built for trust
          </div>
          <h2 className="mt-3 font-display text-4xl font-light leading-tight text-foreground">
            Every run leaves a trail you can inspect.
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground">
            The live browser, event stream, review pause, active-run recovery, and receipt history
            make the automation feel visible instead of mysterious.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FeatureCard
            icon={<Activity className="size-4" />}
            title="Active run recovery"
            copy="Reopen the current live application from the dashboard or extension popup."
          />
          <FeatureCard
            icon={<CheckCircle2 className="size-4" />}
            title="Confidence review"
            copy="Generated and semantic-match answers are highlighted before submit."
          />
          <FeatureCard
            icon={<Library className="size-4" />}
            title="Answer memory"
            copy="Reusable answers fill common questions without repeating model calls."
          />
          <FeatureCard
            icon={<MousePointerClick className="size-4" />}
            title="Job-page button"
            copy="The Chrome extension places AutoApply directly beside supported Apply buttons."
          />
        </div>
      </section>

      <RunHistoryStrip items={history} />
    </motion.div>
  );
}

function HeroMetric({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card/70 px-4 py-3 shadow-card">
      <div className="flex items-center gap-2 text-primary">
        {icon}
        <span className="font-display text-2xl leading-none text-foreground">{value}</span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function ActiveRunBanner({
  run,
  onOpen,
  onDismiss,
}: {
  run: ActiveRun;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const label = run.company ?? hostnameOf(run.jobUrl);
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-6 w-full rounded-2xl border border-primary/25 bg-primary/[0.06] p-4 text-left shadow-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Activity className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">
              Active run in progress
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {label} · {statusLabel(run.status)} · started {relativeTime(run.startedAt)}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90"
          >
            Open live run
            <ExternalLink className="size-3" />
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-full p-1.5 text-muted-foreground transition hover:bg-background/60 hover:text-foreground"
            aria-label="Dismiss active run"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function DropZone({
  dragOver,
  busy,
  onClick,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  dragOver: boolean;
  busy: boolean;
  onClick: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      disabled={busy}
      className={cn(
        "group relative flex w-full cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden rounded-3xl border border-dashed px-8 py-16 text-left transition",
        "border-border bg-card/80 shadow-card backdrop-blur",
        "hover:border-primary/50 hover:bg-card",
        dragOver && "border-primary bg-primary/5 ring-2 ring-primary/30",
        busy && "cursor-progress opacity-80",
      )}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(400px circle at var(--mx, 50%) var(--my, 50%), oklch(0.88 0.19 110 / 0.08), transparent 50%)",
        }}
      />
      <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card/70 shadow-sm">
        {busy ? (
          <Loader2 className="size-6 animate-spin text-primary" />
        ) : dragOver ? (
          <FileText className="size-6 text-primary" />
        ) : (
          <Upload className="size-6 text-foreground/70" />
        )}
      </div>
      <div className="relative flex flex-col items-center text-center">
        <p className="font-display text-2xl text-foreground">
          {busy ? "Reading your résumé…" : dragOver ? "Drop it here" : "Drop your résumé to start"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {busy ? "Parsing it into structured application fields" : "Or click to browse and jump into the apply flow"}
        </p>
      </div>
    </button>
  );
}

function WorkflowStep({
  icon,
  title,
  copy,
}: {
  icon: React.ReactNode;
  title: string;
  copy: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card/70 p-4 shadow-card">
      <div className="flex items-center gap-2 text-primary">
        {icon}
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{copy}</p>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  copy,
}: {
  icon: React.ReactNode;
  title: string;
  copy: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
      <div className="flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {icon}
        </span>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{copy}</p>
    </div>
  );
}

function Supports({ name }: { name: string }) {
  return <span className="text-foreground/60">{name}</span>;
}

function Dot() {
  return <span className="size-1 rounded-full bg-foreground/30" />;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Current application";
  }
}

function statusLabel(status: ActiveRun["status"]): string {
  const labels: Record<ActiveRun["status"], string> = {
    starting: "starting",
    navigating: "reading form",
    filling: "filling",
    awaiting_review: "awaiting review",
    submitting: "submitting",
    submitted: "submitted",
    failed: "failed",
    stopped: "stopped",
  };
  return labels[status];
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
