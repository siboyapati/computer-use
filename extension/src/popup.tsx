import { useEffect, useState } from "react";
import { Activity, Check, Plug, ExternalLink, Loader2, Settings, Sparkles, X } from "lucide-react";
import {
  activeRunFromMeta,
  clearActiveRun,
  isTerminalRunStatus,
  loadActiveRun,
  loadConfig,
  saveActiveRun,
} from "~lib/storage";
import { detectATS, isLikelyValidPostingUrl } from "~lib/detect";
import { fetchRunMetadata, liveRunUrl } from "~lib/api";
import type { ActiveRun, StoredConfig } from "~lib/types";
import "./styles.css";

function Popup() {
  const [config, setConfig] = useState<StoredConfig | null>(null);
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);
  const [activeTabUrl, setActiveTabUrl] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [c, tabs, storedActiveRun] = await Promise.all([
        loadConfig(),
        chrome.tabs.query({ active: true, currentWindow: true }),
        loadActiveRun(),
      ]);
      let nextActiveRun = storedActiveRun;
      if (c.paired && storedActiveRun) {
        try {
          const meta = await fetchRunMetadata(c.apiBase, storedActiveRun.runId);
          if (!meta || isTerminalRunStatus(meta.status)) {
            await clearActiveRun();
            nextActiveRun = null;
          } else {
            nextActiveRun = activeRunFromMeta(meta);
            await saveActiveRun(nextActiveRun);
          }
        } catch {
          // Keep the local recovery hint if the server is temporarily unreachable.
        }
      }
      setConfig(c);
      setActiveRun(nextActiveRun);
      setActiveTabUrl(tabs[0]?.url ?? null);
    })();
  }, []);

  const ats = activeTabUrl ? detectATS(activeTabUrl) : null;
  const isPosting = ats !== null && isLikelyValidPostingUrl(activeTabUrl ?? "");

  function openOptions() {
    chrome.runtime.openOptionsPage().catch(() => {});
  }

  function openActiveRun() {
    if (!config?.paired || !activeRun) return;
    chrome.tabs.create({
      url: liveRunUrl(config.apiBase, activeRun.runId),
      active: true,
    }).catch(() => {});
    window.close();
  }

  async function dismissActiveRun() {
    await clearActiveRun();
    setActiveRun(null);
  }

  async function handleApply() {
    if (!activeTabUrl || applying) return;
    setApplying(true);
    setError(null);
    try {
      const response = (await chrome.runtime.sendMessage({
        type: "apply",
        jobUrl: activeTabUrl,
      })) as { ok: boolean; error?: string };
      if (!response?.ok) throw new Error(response?.error ?? "Failed to start");
      window.close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start");
      setApplying(false);
    }
  }

  if (config === null) {
    return (
      <div className="w-[340px] bg-bg p-6 flex items-center justify-center">
        <Loader2 className="size-4 animate-spin text-muted" />
      </div>
    );
  }

  if (!config.paired) {
    return (
      <div className="w-[340px] bg-bg p-5 animate-fade-up">
        <Brand />
        <h2 className="font-display text-[22px] leading-tight text-ink mt-3">
          Set up{" "}
          <span className="italic gradient-accent">your résumé</span>{" "}
          first.
        </h2>
        <p className="mt-2 text-[13px] text-sub">
          Pair once, then job pages get their own AutoApply button beside Apply.
        </p>
        <button
          className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-accent text-[#15170a] font-medium px-4 py-2.5 text-[14px] transition hover:opacity-90"
          onClick={openOptions}
        >
          <Plug className="size-4" />
          Set up
        </button>
      </div>
    );
  }

  return (
    <div className="w-[340px] bg-bg p-5 animate-fade-up flex flex-col gap-3">
      <Brand />

      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-dim border border-accent-line px-2.5 py-0.5 text-[10px] uppercase tracking-[0.16em] text-accent">
          <Check className="size-3" />
          Connected
        </span>
      </div>

      <div className="glass rounded-2xl p-3.5">
        <div className="text-[10px] uppercase tracking-[0.16em] text-muted">Résumé</div>
        <div className="mt-0.5 font-display text-[18px] leading-tight text-ink">
          {config.resume.personal.fullName}
        </div>
        <div className="mt-0.5 text-[11px] text-muted truncate">{config.fileName}</div>
      </div>

      {activeRun && (
        <div className="rounded-2xl border border-accent-line bg-accent-dim px-3.5 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-accent">
                <Activity className="size-3" />
                Active run
              </div>
              <div className="mt-1 truncate text-[13px] font-medium text-ink">
                {activeRun.company ?? hostnameOf(activeRun.jobUrl)}
              </div>
              <div className="mt-0.5 text-[11px] text-sub">
                {statusLabel(activeRun.status)} · started {relativeTime(activeRun.startedAt)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void dismissActiveRun()}
              className="rounded-full p-1 text-muted transition hover:text-ink"
              aria-label="Dismiss active run"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <button
            type="button"
            onClick={openActiveRun}
            className="mt-2 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-accent text-[#15170a] font-medium px-3 py-2 text-[12px] transition hover:opacity-90"
          >
            Open live run
            <ExternalLink className="size-3" />
          </button>
        </div>
      )}

      {/* Active-tab apply CTA */}
      {isPosting ? (
        <div className="flex flex-col gap-2">
          <div className="rounded-2xl border border-accent-line bg-accent-dim px-3.5 py-2 text-[12px] text-ink/85">
            AutoApply is available directly on this job page, next to the site&apos;s Apply button.
          </div>
          <button
            onClick={handleApply}
            disabled={applying}
            className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-accent text-[#15170a] font-medium px-4 py-3 text-[14px] transition hover:-translate-y-0.5 hover:shadow-glow disabled:opacity-60 disabled:hover:translate-y-0"
          >
            {applying ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Spinning up the agent…
              </>
            ) : (
              <>
                <Sparkles className="size-4" />
                Apply to this {ats === "lever" ? "Lever" : ats === "greenhouse" ? "Greenhouse" : "Ashby"} job
              </>
            )}
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border border-line bg-white/[0.02] px-3.5 py-3 text-[12px] text-muted">
          Open a Lever, Greenhouse, or Ashby posting and AutoApply appears beside the page&apos;s Apply button.
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-danger/30 bg-danger/[0.08] px-3 py-2 text-[12px] text-danger">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 mt-1">
        <a
          href={config.apiBase}
          target="_blank"
          rel="noopener noreferrer"
          className="glass rounded-xl px-3 py-2 text-[12px] inline-flex items-center justify-center gap-1.5 transition hover:border-accent-line hover:text-accent"
        >
          Dashboard
          <ExternalLink className="size-3" />
        </a>
        <button
          onClick={openOptions}
          className="glass rounded-xl px-3 py-2 text-[12px] inline-flex items-center justify-center gap-1.5 transition hover:border-accent-line hover:text-accent"
        >
          <Settings className="size-3" />
          Settings
        </button>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <span className="font-display text-[20px] italic text-accent leading-none">a/a</span>
      <span className="text-[10px] uppercase tracking-[0.28em] text-sub">AutoApply</span>
    </div>
  );
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

export default Popup;
