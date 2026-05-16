"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { ArrowRight, ArrowLeft, Loader2, AlertCircle, Send, ShieldCheck, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ResumeCard } from "./resume-card";
import {
  detectATS,
  isLikelyValidPostingUrl,
  MODEL_CHOICES,
  type ATS,
  type LLMProvider,
  type Resume,
} from "@/lib/agent/types";
import { cn } from "@/lib/utils";

interface Props {
  resume: Resume;
  fileName: string;
  initialUrl?: string;
  initialProvider?: LLMProvider;
  initialReviewMode?: boolean;
  onBack: () => void;
  onStart: (
    jobUrl: string,
    provider: LLMProvider,
    reviewMode: boolean,
  ) => Promise<void>;
}

export function Confirm({
  resume,
  fileName,
  initialUrl = "",
  initialProvider = "anthropic",
  initialReviewMode = true,
  onBack,
  onStart,
}: Props) {
  const [jobUrl, setJobUrl] = useState(initialUrl);
  const [provider, setProvider] = useState<LLMProvider>(initialProvider);
  const [reviewMode, setReviewMode] = useState(initialReviewMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ats: ATS | null = detectATS(jobUrl);
  const urlOk = Boolean(ats) && isLikelyValidPostingUrl(jobUrl);
  const canStart = urlOk && !busy;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ type: "spring", stiffness: 220, damping: 28 }}
      className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 pb-12 pt-16"
    >
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/40 px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="size-3" />
          Different résumé
        </button>
        <div className="text-xs text-muted-foreground">
          <span className="text-foreground/60">{fileName}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.2fr_1fr]">
        <ResumeCard resume={resume} />

        <div className="flex flex-col gap-6">
          <div>
            <h2 className="font-display text-3xl text-foreground">Pick a posting.</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Lever, Greenhouse, or Ashby. The agent will fill every field and submit a real
              application — make sure this is a job you actually want.
            </p>
          </div>

          <div className="glass rounded-2xl p-5">
            <Label htmlFor="jobUrl" className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Job posting URL
            </Label>
            <Input
              id="jobUrl"
              value={jobUrl}
              onChange={(e) => setJobUrl(e.target.value)}
              placeholder="https://jobs.lever.co/company/abc123…"
              className="mt-2 h-12 border-0 bg-transparent px-0 font-mono text-base placeholder:text-muted-foreground/50 focus-visible:ring-0"
              autoFocus
            />
            <div className="mt-2 flex items-center justify-between">
              <ATSBadge ats={ats} url={jobUrl} />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Agent model
            </div>
            <ModelToggle provider={provider} onChange={setProvider} />
          </div>

          <div className="glass rounded-2xl p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-foreground">
                {reviewMode ? (
                  <ShieldCheck className="size-4 text-primary" />
                ) : (
                  <Zap className="size-4 text-amber-400" />
                )}
                <span className="font-medium">
                  {reviewMode ? "Review before submit" : "Auto-submit"}
                </span>
              </div>
              <ReviewModeToggle value={reviewMode} onChange={setReviewMode} />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {reviewMode
                ? "Agent fills + uploads, then pauses. You click 'Submit for real' on the live screen."
                : "Agent clicks submit on its own once every field is filled."}
            </p>
          </div>

          {!reviewMode && (
            <div className="flex items-start gap-2 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/5 dark:text-amber-200/90">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <span className="font-medium text-amber-950 dark:text-amber-100">
                  Heads up — auto-submit is on.
                </span>{" "}
                The agent will click submit without asking. Use a posting you actually want to apply to.
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
              {error}
            </div>
          )}

          <Button
            size="lg"
            className="h-14 rounded-2xl text-base font-medium shadow-lg shadow-primary/20"
            disabled={!canStart}
            onClick={async () => {
              setError(null);
              setBusy(true);
              try {
                await onStart(jobUrl, provider, reviewMode);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Failed to start");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Spinning up the browser…
              </>
            ) : (
              <>
                <Send className="size-4" />
                Start applying
                <ArrowRight className="size-4" />
              </>
            )}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

function ATSBadge({ ats, url }: { ats: ATS | null; url: string }) {
  if (!url) return <span className="text-xs text-muted-foreground/70">Paste a Lever, Greenhouse, or Ashby URL</span>;
  if (!ats) return <span className="text-xs text-destructive/80">Unsupported ATS</span>;
  if (!isLikelyValidPostingUrl(url))
    return <span className="text-xs text-amber-300/80">URL needs a posting path (not just the host)</span>;
  const label = ats[0].toUpperCase() + ats.slice(1);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className="size-1.5 animate-pulse rounded-full bg-primary" />
      <span className="text-foreground/80">{label} detected</span>
    </span>
  );
}

function ReviewModeToggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className={cn(
        "relative inline-flex h-6 w-11 items-center rounded-full border transition",
        value ? "bg-primary/30 border-primary/50" : "bg-muted border-border",
      )}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
        className={cn(
          "block size-5 rounded-full shadow-sm",
          value ? "bg-primary" : "bg-foreground/60",
        )}
        style={{ marginLeft: value ? "calc(100% - 1.25rem - 2px)" : "2px" }}
      />
    </button>
  );
}

function ModelToggle({
  provider,
  onChange,
}: {
  provider: LLMProvider;
  onChange: (p: LLMProvider) => void;
}) {
  const order: LLMProvider[] = ["anthropic", "google"];
  return (
    <div className="relative inline-flex items-center gap-1 rounded-full border border-border bg-card/60 p-0.5 text-xs">
      {order.map((p) => {
        const c = MODEL_CHOICES[p];
        const active = p === provider;
        return (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={cn(
              "relative rounded-full px-3 py-1 transition",
              active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId="model-toggle-pill"
                className="absolute inset-0 rounded-full bg-primary"
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
              />
            )}
            <span className="relative">{c.shortLabel}</span>
          </button>
        );
      })}
    </div>
  );
}
