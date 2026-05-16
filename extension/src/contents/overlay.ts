import type { PlasmoCSConfig } from "plasmo";
import { detectATS, isLikelyValidPostingUrl } from "~lib/detect";
import { loadConfig } from "~lib/storage";

export const config: PlasmoCSConfig = {
  matches: [
    "https://*.lever.co/*",
    "https://*.greenhouse.io/*",
    "https://*.ashbyhq.com/*",
  ],
  run_at: "document_idle",
};

const HOST_ID = "autoapply-floating-host";
const STATE = {
  attached: false,
  loading: false,
};

void mount();

// Re-mount if SPA navigation happens (Ashby) or if the user pairs after the page loaded
window.addEventListener("popstate", () => void mount());
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && typeof msg === "object" && (msg as { type?: string }).type === "config-changed") {
    void mount();
  }
});

async function mount(): Promise<void> {
  const url = window.location.href;
  const ats = detectATS(url);
  if (!ats || !isLikelyValidPostingUrl(url)) {
    teardown();
    return;
  }
  const cfg = await loadConfig();
  if (!cfg.paired) {
    teardown();
    return;
  }
  if (STATE.attached) return;
  attach();
}

function teardown(): void {
  const existing = document.getElementById(HOST_ID);
  if (existing) existing.remove();
  STATE.attached = false;
  STATE.loading = false;
}

function attach(): void {
  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 2147483647;
    all: initial;
  `;
  const shadow = host.attachShadow({ mode: "open" });

  const styles = document.createElement("style");
  styles.textContent = STYLES;
  shadow.appendChild(styles);

  const button = document.createElement("button");
  button.className = "aa-fab";
  button.innerHTML = `
    <span class="aa-fab-mark">a/a</span>
    <span class="aa-fab-label">Apply with AutoApply</span>
    <span class="aa-fab-arrow" aria-hidden="true">→</span>
  `;
  button.addEventListener("click", handleClick);

  const toast = document.createElement("div");
  toast.className = "aa-toast";
  toast.id = "aa-toast";

  shadow.appendChild(button);
  shadow.appendChild(toast);
  document.documentElement.appendChild(host);
  STATE.attached = true;
}

async function handleClick(this: HTMLButtonElement): Promise<void> {
  if (STATE.loading) return;
  STATE.loading = true;
  this.classList.add("aa-loading");
  setLabel(this, "Spinning up the agent…");

  try {
    const response = (await chrome.runtime.sendMessage({
      type: "apply",
      jobUrl: window.location.href,
    })) as { ok: boolean; runId?: string; error?: string };

    if (!response?.ok) {
      throw new Error(response?.error ?? "Server returned an error");
    }
    setLabel(this, "Opened in new tab ↗");
    setTimeout(() => {
      this.classList.remove("aa-loading");
      setLabel(this, "Apply with AutoApply");
      STATE.loading = false;
    }, 2500);
  } catch (err) {
    showToast(err instanceof Error ? err.message : "Apply failed");
    this.classList.remove("aa-loading");
    setLabel(this, "Apply with AutoApply");
    STATE.loading = false;
  }
}

function setLabel(button: HTMLButtonElement, text: string): void {
  const label = button.querySelector(".aa-fab-label");
  if (label) label.textContent = text;
}

function showToast(message: string): void {
  const host = document.getElementById(HOST_ID);
  if (!host?.shadowRoot) return;
  const toast = host.shadowRoot.getElementById("aa-toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("aa-toast-show");
  setTimeout(() => toast.classList.remove("aa-toast-show"), 4000);
}

const STYLES = `
  @import url("https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300..600&display=swap");

  :host, .aa-fab, .aa-fab *, .aa-toast {
    box-sizing: border-box;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }
  @keyframes aa-pop {
    from { opacity: 0; transform: translateY(8px) scale(0.96); }
    to   { opacity: 1; transform: translateY(0)   scale(1); }
  }
  @keyframes aa-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(212, 255, 80, 0.4); }
    50%      { box-shadow: 0 0 0 8px rgba(212, 255, 80, 0); }
  }
  @keyframes aa-spin { to { transform: rotate(360deg); } }
  .aa-fab {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 13px 20px 13px 16px;
    border-radius: 999px;
    background: linear-gradient(180deg, #1f1d18, #0e0d0b);
    border: 1px solid rgba(212, 255, 80, 0.32);
    color: #f5f1ea;
    font-size: 14px;
    font-weight: 500;
    line-height: 1;
    cursor: pointer;
    box-shadow:
      0 14px 36px rgba(0, 0, 0, 0.5),
      0 0 0 1px rgba(255, 255, 255, 0.04),
      0 0 32px rgba(212, 255, 80, 0.18);
    transition: transform 220ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 220ms ease, border-color 220ms ease;
    animation: aa-pop 320ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .aa-fab:hover {
    transform: translateY(-2px);
    border-color: rgba(212, 255, 80, 0.6);
    box-shadow:
      0 18px 44px rgba(0, 0, 0, 0.55),
      0 0 0 1px rgba(255, 255, 255, 0.04),
      0 0 44px rgba(212, 255, 80, 0.32);
  }
  .aa-fab:active {
    transform: translateY(0);
  }
  .aa-fab.aa-loading {
    cursor: progress;
    opacity: 0.92;
    animation: aa-pulse 1.4s ease-out infinite;
  }
  .aa-fab.aa-loading .aa-fab-arrow {
    border: 2px solid rgba(212, 255, 80, 0.25);
    border-top-color: #d4ff50;
    border-radius: 50%;
    width: 14px;
    height: 14px;
    animation: aa-spin 0.8s linear infinite;
    background: none;
    color: transparent;
  }
  .aa-fab-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 999px;
    background: rgba(212, 255, 80, 0.14);
    border: 1px solid rgba(212, 255, 80, 0.32);
    font-family: "Fraunces", Georgia, serif;
    font-style: italic;
    font-size: 15px;
    font-weight: 400;
    color: #d4ff50;
    letter-spacing: -0.04em;
  }
  .aa-fab-label {
    letter-spacing: 0.005em;
    color: rgba(245, 241, 234, 0.92);
  }
  .aa-fab-arrow {
    color: #d4ff50;
    font-size: 15px;
    line-height: 1;
    transition: transform 220ms ease;
  }
  .aa-fab:hover .aa-fab-arrow {
    transform: translateX(3px);
  }
  .aa-toast {
    margin-top: 10px;
    padding: 10px 14px;
    border-radius: 14px;
    background: rgba(220, 40, 40, 0.92);
    color: #fff;
    font-size: 12px;
    max-width: 280px;
    opacity: 0;
    transform: translateY(8px);
    transition: opacity 220ms ease, transform 220ms ease;
    pointer-events: none;
    backdrop-filter: blur(8px);
  }
  .aa-toast-show {
    opacity: 1;
    transform: translateY(0);
  }
`;
