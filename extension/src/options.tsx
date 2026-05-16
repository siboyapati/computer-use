import { useEffect, useState } from "react";
import {
  Plug,
  Check,
  Loader2,
  ExternalLink,
  Trash2,
  Sparkles,
  ArrowRight,
  Globe2,
} from "lucide-react";
import { loadConfig, clearConfig } from "~lib/storage";
import { connectUrl } from "~lib/api";
import type { StoredConfig } from "~lib/types";
import "./styles.css";

const API_BASE = process.env.PLASMO_PUBLIC_API_BASE ?? "http://localhost:3000";

function Options() {
  const [config, setConfig] = useState<StoredConfig | null>(null);
  const [pairing, setPairing] = useState(false);

  useEffect(() => {
    void refresh();
    const onChanged = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if ("autoapply.config.v1" in changes) {
        setPairing(false);
        void refresh();
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  async function refresh() {
    const c = await loadConfig();
    setConfig(c);
  }

  function handleConnect() {
    setPairing(true);
    chrome.tabs.create({ url: connectUrl(API_BASE, chrome.runtime.id) });
  }

  async function handleDisconnect() {
    await clearConfig();
    setConfig({ paired: false });
  }

  const loading = config === null;
  const unpaired = config?.paired === false;
  const paired = config?.paired === true;

  return (
    <div className="min-h-screen w-full">
      <div className="mx-auto max-w-2xl px-8 pt-16 pb-16 animate-fade-up">
        <header className="mb-10 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="font-display text-2xl italic text-accent leading-none">a/a</span>
            <span className="text-[11px] uppercase tracking-[0.28em] text-sub">AutoApply</span>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card/50 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-muted backdrop-blur">
            <Sparkles className="size-3 text-accent" />
            Extension
          </span>
        </header>

        <h1 className="font-display text-[56px] leading-[1] font-light tracking-tight text-ink">
          One-click apply,
          <br />
          <span className="italic gradient-accent">everywhere you find a job.</span>
        </h1>

        <p className="mt-5 max-w-lg text-[15px] text-sub leading-relaxed">
          Pair this extension with your AutoApply web app once. After that, a floating button on
          every Lever, Greenhouse, and Ashby posting fires a vision-driven agent that fills the
          form for you — live, in a new tab, while you keep browsing.
        </p>

        {loading && (
          <div className="mt-12 glass rounded-2xl p-6 flex items-center gap-2 text-muted">
            <Loader2 className="size-4 animate-spin" />
            <span>Loading…</span>
          </div>
        )}

        {unpaired && (
          <div className="mt-12 glass rounded-3xl p-7 animate-fade-up">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-[0.18em] text-muted">Status</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/[0.02] px-2.5 py-0.5 text-[10px] uppercase tracking-[0.16em] text-muted">
                Not connected
              </span>
            </div>

            <ol className="mt-6 space-y-3 text-[14px] text-sub">
              <Step n={1}>
                Open{" "}
                <a
                  href={API_BASE}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline inline-flex items-center gap-1"
                >
                  {API_BASE.replace(/^https?:\/\//, "")}
                  <ExternalLink className="size-3 opacity-80" />
                </a>{" "}
                and drop your résumé.
              </Step>
              <Step n={2}>Come back to this page.</Step>
              <Step n={3}>Click the button below.</Step>
            </ol>

            <button
              className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-accent text-[#15170a] font-medium px-5 py-3.5 text-[15px] transition hover:-translate-y-0.5 hover:shadow-glow disabled:opacity-50 disabled:hover:translate-y-0"
              onClick={handleConnect}
              disabled={pairing}
            >
              {pairing ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Waiting for the new tab…
                </>
              ) : (
                <>
                  <Plug className="size-4" />
                  Connect to AutoApply
                  <ArrowRight className="size-4" />
                </>
              )}
            </button>
          </div>
        )}

        {paired && config.paired === true && (
          <div className="mt-12 grid gap-4 animate-fade-up">
            <div className="glass rounded-3xl p-6">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-dim border border-accent-line px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-accent">
                  <Check className="size-3" />
                  Connected
                </span>
                <span className="text-[11px] text-muted">paired {timeAgo(config.pairedAt)}</span>
              </div>

              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-5">
                <Field label="Résumé">
                  <div className="font-display text-[22px] leading-tight text-ink">
                    {config.resume.personal.fullName}
                  </div>
                  <div className="mt-0.5 text-[12px] text-muted truncate">{config.fileName}</div>
                </Field>
                <Field label="Server">
                  <a
                    href={config.apiBase}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[13px] text-ink/85 hover:text-accent inline-flex items-center gap-1.5"
                  >
                    <Globe2 className="size-3.5 opacity-60" />
                    {config.apiBase.replace(/^https?:\/\//, "")}
                    <ExternalLink className="size-3 opacity-60" />
                  </a>
                </Field>
              </div>

              {config.resume.headline && (
                <div className="mt-5 text-[13px] text-sub">{config.resume.headline}</div>
              )}

              {config.resume.skills && config.resume.skills.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {config.resume.skills.slice(0, 10).map((s) => (
                    <span
                      key={s}
                      className="rounded-full border border-line bg-white/[0.03] px-2 py-0.5 text-[11px] text-ink/75"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <a
                href={config.apiBase}
                target="_blank"
                rel="noopener noreferrer"
                className="glass rounded-2xl px-4 py-3 text-[14px] inline-flex items-center justify-center gap-2 transition hover:border-accent-line hover:text-accent"
              >
                Open dashboard
                <ExternalLink className="size-3.5" />
              </a>
              <button
                className="glass rounded-2xl px-4 py-3 text-[14px] inline-flex items-center justify-center gap-2 transition hover:border-accent-line hover:text-accent"
                onClick={handleConnect}
              >
                <Plug className="size-3.5" />
                Re-pair
              </button>
              <button
                className="rounded-2xl border border-danger/30 bg-danger/[0.06] px-4 py-3 text-[14px] text-danger inline-flex items-center justify-center gap-2 transition hover:bg-danger/[0.12]"
                onClick={handleDisconnect}
              >
                <Trash2 className="size-3.5" />
                Disconnect
              </button>
            </div>

            <div className="glass rounded-2xl p-5">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted">How it works</div>
              <p className="mt-2 text-[13px] text-sub leading-relaxed">
                Visit a job on <span className="text-ink/85">Lever</span>,{" "}
                <span className="text-ink/85">Greenhouse</span>, or{" "}
                <span className="text-ink/85">Ashby</span>. A floating &ldquo;Apply with AutoApply&rdquo;
                button appears bottom-right. Click it; a new tab opens with the agent already
                filling the form. The agent pauses before the final submit — you click{" "}
                <span className="text-accent">Submit for real</span> when you&apos;re happy.
              </p>
            </div>
          </div>
        )}

        <footer className="mt-14 text-center text-[11px] text-muted/80">
          Every action is triggered by your click. We never auto-submit without you.
        </footer>
      </div>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-px inline-flex size-6 flex-shrink-0 items-center justify-center rounded-full border border-accent-line bg-accent-dim text-[11px] font-medium text-accent">
        {n}
      </span>
      <span className="text-ink/80">{children}</span>
    </li>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted mb-1.5">{label}</div>
      {children}
    </div>
  );
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default Options;
