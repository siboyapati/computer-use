import { useEffect, useState } from "react";
import { Check, Plug, ExternalLink, Loader2, Settings, Sparkles } from "lucide-react";
import { loadConfig } from "~lib/storage";
import { detectATS, isLikelyValidPostingUrl } from "~lib/detect";
import type { StoredConfig } from "~lib/types";
import "./styles.css";

function Popup() {
  const [config, setConfig] = useState<StoredConfig | null>(null);
  const [activeTabUrl, setActiveTabUrl] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [c, tabs] = await Promise.all([
        loadConfig(),
        chrome.tabs.query({ active: true, currentWindow: true }),
      ]);
      setConfig(c);
      setActiveTabUrl(tabs[0]?.url ?? null);
    })();
  }, []);

  const ats = activeTabUrl ? detectATS(activeTabUrl) : null;
  const isPosting = ats !== null && isLikelyValidPostingUrl(activeTabUrl ?? "");

  function openOptions() {
    chrome.runtime.openOptionsPage().catch(() => {});
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

export default Popup;
