"use client";

import { useCallback, useRef, useState } from "react";
import { motion } from "motion/react";
import { Upload, FileText, Sparkles, Loader2, RotateCcw, X, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { RunHistoryStrip } from "./run-history";
import type { HistoryItem, StoredResume } from "@/lib/storage";

interface Props {
  onParsed: (data: { resume: unknown; pdfBase64: string; fileName: string }) => void;
  onError: (message: string) => void;
  onUseSample: () => Promise<void>;
  storedResume: StoredResume | null;
  history: HistoryItem[];
  onUseStoredResume: () => void;
  onForgetStoredResume: () => void;
}

export function Landing({
  onParsed,
  onError,
  onUseSample,
  storedResume,
  history,
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
      className="mx-auto flex w-full max-w-3xl flex-col items-center px-6 pt-24 pb-12 text-center"
    >
      <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card/50 px-3 py-1 text-xs uppercase tracking-[0.18em] text-muted-foreground backdrop-blur">
        <Sparkles className="size-3 text-primary" />
        Vision-driven AI agent
      </div>

      <h1 className="font-display text-balance text-6xl font-light leading-[1.02] text-foreground md:text-7xl">
        Apply to <span className="italic text-gradient-accent">fifty</span> jobs
        <br />
        in the time of one.
      </h1>

      <p className="mt-6 max-w-xl text-balance text-lg text-muted-foreground">
        Drop your résumé, paste a job URL, then watch the agent fill the application live in your
        browser. Real form, real submit, real receipts.
      </p>

      <div className="mt-12 w-full">
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

        {/* Secondary CTAs below the drop zone. Both stay subtle so the
            primary drop-zone affordance keeps focus. Either button skips
            the parse step entirely:
              - "Use last résumé" loads from localStorage (no API call).
              - "Try with sample résumé" loads a built-in synthetic résumé
                + the PDF from public/sample-resume.pdf. */}
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground"
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
      </div>

      <div className="mt-10 flex items-center gap-6 text-xs uppercase tracking-[0.18em] text-muted-foreground">
        <Supports name="Lever" />
        <Dot />
        <Supports name="Greenhouse" />
        <Dot />
        <Supports name="Ashby" />
      </div>

      <RunHistoryStrip items={history} />
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
        "border-border bg-card/30 backdrop-blur",
        "hover:border-primary/50 hover:bg-card/50",
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
          {busy ? "Reading your résumé…" : dragOver ? "Drop it here" : "Drop your résumé"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {busy ? "Claude is parsing it into structured fields" : "PDF up to 5 MB — or click to browse"}
        </p>
      </div>
    </button>
  );
}

function Supports({ name }: { name: string }) {
  return <span className="text-foreground/60">{name}</span>;
}

function Dot() {
  return <span className="size-1 rounded-full bg-foreground/30" />;
}
