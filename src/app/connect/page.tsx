"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { Check, AlertCircle, Loader2, Plug, ArrowRight } from "lucide-react";
import { loadResume, type StoredResume } from "@/lib/storage";
import { Button } from "@/components/ui/button";

// Chrome's API typing isn't bundled by default. Declare a minimal shape we use.
declare global {
  interface Window {
    chrome?: {
      runtime?: {
        sendMessage?: (
          extId: string,
          message: unknown,
          callback?: (response: unknown) => void,
        ) => void;
        lastError?: { message?: string };
      };
    };
  }
}

export default function ConnectPage() {
  return (
    <main className="relative flex min-h-screen flex-col">
      <Brand />
      <Suspense fallback={<LoadingState />}>
        <ConnectInner />
      </Suspense>
    </main>
  );
}

type Status = "loading" | "no-resume" | "ready" | "pairing" | "success" | "error";

function ConnectInner() {
  const [status, setStatus] = useState<Status>("loading");
  const [extId, setExtId] = useState<string | null>(null);
  const [stored, setStored] = useState<StoredResume | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const id = params.get("ext_id");
    if (!id) {
      setError("Missing ext_id parameter. Open this page from the extension's options.");
      setStatus("error");
      return;
    }
    setExtId(id);
    const resume = loadResume();
    if (!resume) {
      setStatus("no-resume");
      return;
    }
    setStored(resume);
    setStatus("ready");
  }, []);

  async function handlePair() {
    if (!extId || !stored) return;
    setStatus("pairing");
    try {
      const chrome = window.chrome;
      if (!chrome?.runtime?.sendMessage) {
        throw new Error(
          "Chrome runtime not reachable. Make sure the extension is installed and its `externally_connectable.matches` includes this origin.",
        );
      }
      await new Promise<void>((resolve, reject) => {
        chrome.runtime!.sendMessage!(
          extId,
          {
            type: "pair",
            resume: stored.resume,
            pdfBase64: stored.pdfBase64,
            fileName: stored.fileName,
            apiBase: window.location.origin,
          },
          (response: unknown) => {
            const lastError = chrome.runtime?.lastError;
            if (lastError) {
              reject(new Error(lastError.message ?? "Extension didn't respond"));
              return;
            }
            const r = response as { ok?: boolean; error?: string } | undefined;
            if (r?.ok) resolve();
            else reject(new Error(r?.error ?? "Extension rejected pairing"));
          },
        );
      });
      setStatus("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pairing failed");
      setStatus("error");
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 220, damping: 28 }}
      className="mx-auto flex w-full max-w-xl flex-col items-center px-6 pt-24 pb-12"
    >
      <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card/50 px-3 py-1 text-xs uppercase tracking-[0.18em] text-muted-foreground backdrop-blur">
        <Plug className="size-3 text-primary" />
        Pair extension
      </div>

      <h1 className="font-display text-balance text-center text-5xl font-light leading-[1.05] text-foreground">
        Connect{" "}
        <span className="italic text-gradient-accent">your résumé</span>
        <br />
        to the extension.
      </h1>

      {status === "loading" && (
        <div className="mt-12 flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading…
        </div>
      )}

      {status === "no-resume" && (
        <div className="glass mt-12 w-full rounded-2xl p-6 text-center">
          <AlertCircle className="mx-auto size-6 text-amber-600 dark:text-amber-400" />
          <p className="mt-3 text-foreground">No résumé saved yet on this browser.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Drop your résumé on the home page first, then come back here.
          </p>
          <Link
            href="/"
            className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            Go set up
            <ArrowRight className="size-3.5" />
          </Link>
        </div>
      )}

      {(status === "ready" || status === "pairing") && stored && (
        <div className="glass mt-12 w-full rounded-2xl p-6">
          <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Extension ID
          </div>
          <div className="mt-1 truncate font-mono text-xs text-foreground/70">{extId}</div>

          <div className="mt-5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Résumé this extension will use
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-display text-2xl text-foreground">
              {stored.resume.personal.fullName}
            </span>
            <span className="text-xs text-muted-foreground">· {stored.fileName}</span>
          </div>

          <p className="mt-5 text-xs text-muted-foreground">
            The extension will store this résumé locally in its own storage (not on our servers).
            It will be used every time you click the &quot;Apply with AutoApply&quot; button on a
            Lever, Greenhouse, or Ashby posting.
          </p>

          <Button
            size="lg"
            className="mt-6 h-12 w-full rounded-xl text-base"
            disabled={status === "pairing"}
            onClick={handlePair}
          >
            {status === "pairing" ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Pairing…
              </>
            ) : (
              <>
                <Plug className="size-4" />
                Allow + Pair
              </>
            )}
          </Button>
        </div>
      )}

      {status === "success" && (
        <div className="glass mt-12 w-full rounded-2xl p-6 text-center">
          <div className="mx-auto inline-flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="size-5" />
          </div>
          <p className="mt-4 font-display text-2xl text-foreground">Paired.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Return to the extension. The floating button will now appear on supported job pages.
          </p>
        </div>
      )}

      {status === "error" && (
        <div className="mt-12 w-full rounded-2xl border border-destructive/40 bg-destructive/10 p-5 text-sm text-destructive">
          <div className="font-medium text-destructive">Pairing failed</div>
          <div className="mt-1 text-destructive/85">{error}</div>
        </div>
      )}
    </motion.div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-1 items-center justify-center text-muted-foreground">
      <Loader2 className="size-5 animate-spin" />
    </div>
  );
}

function Brand() {
  return (
    <div className="pointer-events-none fixed left-6 top-5 z-30">
      <Link href="/" className="pointer-events-auto inline-flex items-center gap-2 text-[12px] uppercase tracking-[0.28em] text-foreground/85">
        <span className="font-display lowercase italic tracking-normal text-base">a/a</span>
        <span className="hidden text-foreground/60 sm:inline">AutoApply</span>
      </Link>
    </div>
  );
}
