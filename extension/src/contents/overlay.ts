import type { PlasmoCSConfig } from "plasmo";
import { detectATS, isLikelyValidPostingUrl } from "~lib/detect";
import { loadConfig } from "~lib/storage";
import type { ATS, StoredConfig } from "~lib/types";

export const config: PlasmoCSConfig = {
  matches: [
    "https://*.lever.co/*",
    "https://*.greenhouse.io/*",
    "https://*.ashbyhq.com/*",
  ],
  run_at: "document_idle",
};

const DOCK_HOST_ID = "autoapply-floating-host";
const INLINE_HOST_ID = "autoapply-inline-host";
const APPLY_TARGET_ATTR = "data-autoapply-inline-target";

const STATE: {
  loading: boolean;
  currentUrl: string | null;
  dismissedDockUrl: string | null;
  scanTimer: number | null;
  observer: MutationObserver | null;
} = {
  loading: false,
  currentUrl: null,
  dismissedDockUrl: null,
  scanTimer: null,
  observer: null,
};

void mount();

window.addEventListener("popstate", () => scheduleMount());
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && typeof msg === "object" && (msg as { type?: string }).type === "config-changed") {
    scheduleMount();
  }
});

const pushState = window.history.pushState;
window.history.pushState = function patchedPushState(...args) {
  const result = pushState.apply(this, args);
  scheduleMount();
  return result;
};

const replaceState = window.history.replaceState;
window.history.replaceState = function patchedReplaceState(...args) {
  const result = replaceState.apply(this, args);
  scheduleMount();
  return result;
};

function scheduleMount(): void {
  if (STATE.scanTimer !== null) window.clearTimeout(STATE.scanTimer);
  STATE.scanTimer = window.setTimeout(() => {
    STATE.scanTimer = null;
    void mount();
  }, 300);
}

async function mount(): Promise<void> {
  const url = window.location.href;
  const ats = detectATS(url);
  if (!ats || !isLikelyValidPostingUrl(url)) {
    teardown();
    return;
  }

  const cfg = await loadConfig();
  if (STATE.currentUrl !== url) STATE.dismissedDockUrl = null;
  STATE.currentUrl = url;
  renderDock({ ats, cfg });
  renderInlineButton({ ats, cfg });
  ensureObserver();
}

function teardown(): void {
  document.getElementById(DOCK_HOST_ID)?.remove();
  document.getElementById(INLINE_HOST_ID)?.remove();
  document.querySelector(`[${APPLY_TARGET_ATTR}="true"]`)?.removeAttribute(APPLY_TARGET_ATTR);
  STATE.loading = false;
  STATE.currentUrl = null;
  if (STATE.scanTimer !== null) window.clearTimeout(STATE.scanTimer);
  STATE.scanTimer = null;
  STATE.observer?.disconnect();
  STATE.observer = null;
}

function ensureObserver(): void {
  if (STATE.observer) return;
  STATE.observer = new MutationObserver(() => {
    const urlChanged = STATE.currentUrl !== window.location.href;
    const missingInline = !document.getElementById(INLINE_HOST_ID);
    if (urlChanged || missingInline) scheduleMount();
  });
  STATE.observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

function renderDock({ ats, cfg }: { ats: ATS; cfg: StoredConfig }): void {
  if (STATE.dismissedDockUrl === window.location.href) {
    document.getElementById(DOCK_HOST_ID)?.remove();
    return;
  }

  const existing = document.getElementById(DOCK_HOST_ID);
  const host = existing ?? document.createElement("div");
  host.id = DOCK_HOST_ID;
  host.style.cssText = `
    all: initial;
    position: fixed;
    right: 22px;
    bottom: 22px;
    z-index: 2147483647;
  `;
  if (!existing) document.documentElement.appendChild(host);

  const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  shadow.textContent = "";
  const styles = document.createElement("style");
  styles.textContent = STYLES;
  shadow.appendChild(styles);

  const dock = document.createElement("section");
  dock.className = "aa-dock";
  dock.setAttribute("aria-label", "AutoApply quick apply");
  dock.innerHTML = cfg.paired
    ? pairedDockMarkup(cfg, ats)
    : unpairedDockMarkup(ats);

  const button = dock.querySelector<HTMLButtonElement>(".aa-primary");
  button?.addEventListener("click", cfg.paired ? handleApplyClick : handleSetupClick);

  const close = dock.querySelector<HTMLButtonElement>(".aa-close");
  close?.addEventListener("click", () => {
    STATE.dismissedDockUrl = window.location.href;
    host.remove();
  });

  shadow.appendChild(dock);
}

function renderInlineButton({ ats, cfg }: { ats: ATS; cfg: StoredConfig }): void {
  const existingInline = document.getElementById(INLINE_HOST_ID);
  const target = findNativeApplyTarget();
  if (!target) {
    existingInline?.remove();
    return;
  }

  if (
    existingInline &&
    existingInline.parentElement === target.parentElement &&
    target.getAttribute(APPLY_TARGET_ATTR) === "true"
  ) {
    updateInline(existingInline, { ats, cfg });
    return;
  }

  existingInline?.remove();
  document.querySelector(`[${APPLY_TARGET_ATTR}="true"]`)?.removeAttribute(APPLY_TARGET_ATTR);
  target.setAttribute(APPLY_TARGET_ATTR, "true");

  const host = document.createElement("span");
  host.id = INLINE_HOST_ID;
  host.style.cssText = `
    display: inline-flex;
    vertical-align: middle;
    margin-left: 10px;
    margin-top: 8px;
    max-width: 100%;
  `;
  target.insertAdjacentElement("afterend", host);
  updateInline(host, { ats, cfg });
}

function updateInline(host: HTMLElement, { ats, cfg }: { ats: ATS; cfg: StoredConfig }): void {
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  shadow.textContent = "";
  const styles = document.createElement("style");
  styles.textContent = STYLES;
  shadow.appendChild(styles);

  const button = document.createElement("button");
  button.className = cfg.paired ? "aa-inline aa-inline-ready" : "aa-inline aa-inline-setup";
  button.innerHTML = cfg.paired
    ? `
      <span class="aa-inline-spark">✦</span>
      <span class="aa-inline-text">
        <strong>One-click apply with AutoApply</strong>
        <small>${inlineStatus(cfg)}</small>
      </span>
      <span class="aa-inline-ats">${labelForATS(ats)}</span>
    `
    : `
      <span class="aa-inline-spark">✦</span>
      <span>Set up one-click apply</span>
    `;
  button.addEventListener("click", cfg.paired ? handleApplyClick : handleSetupClick);
  shadow.appendChild(button);
}

async function handleApplyClick(this: HTMLButtonElement): Promise<void> {
  if (STATE.loading) return;
  STATE.loading = true;
  setBusy(true, "Starting agent...");

  try {
    const response = (await chrome.runtime.sendMessage({
      type: "apply",
      jobUrl: window.location.href,
    })) as { ok: boolean; runId?: string; error?: string };

    if (!response?.ok) throw new Error(response?.error ?? "Server returned an error");
    setBusy(false, "Opening live run...");
    showNotice("Live application opened in a new tab.", "success");
    window.setTimeout(() => {
      STATE.loading = false;
      void mount();
    }, 1600);
  } catch (err) {
    STATE.loading = false;
    setBusy(false);
    showNotice(err instanceof Error ? err.message : "Apply failed", "error");
  }
}

async function handleSetupClick(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: "open-options" });
  } catch {
    chrome.runtime.openOptionsPage?.();
  }
}

function setBusy(isBusy: boolean, text?: string): void {
  for (const root of getShadowRoots()) {
    const buttons = root.querySelectorAll<HTMLButtonElement>(".aa-primary, .aa-inline");
    for (const button of buttons) {
      button.classList.toggle("aa-loading", isBusy);
      button.disabled = isBusy;
    }
    if (text) {
      const label = root.querySelector<HTMLElement>(".aa-primary-label");
      if (label) label.textContent = text;
    }
  }
}

function showNotice(message: string, kind: "success" | "error"): void {
  const host = document.getElementById(DOCK_HOST_ID);
  if (!host?.shadowRoot) return;
  const toast = host.shadowRoot.querySelector<HTMLElement>(".aa-toast");
  if (!toast) return;
  toast.textContent = message;
  toast.dataset.kind = kind;
  toast.classList.add("aa-toast-show");
  window.setTimeout(() => toast.classList.remove("aa-toast-show"), 4200);
}

function getShadowRoots(): ShadowRoot[] {
  return [DOCK_HOST_ID, INLINE_HOST_ID]
    .map((id) => document.getElementById(id)?.shadowRoot)
    .filter((root): root is ShadowRoot => Boolean(root));
}

function pairedDockMarkup(cfg: Extract<StoredConfig, { paired: true }>, ats: ATS): string {
  const name = escapeHtml(cfg.resume.personal.fullName || "Resume ready");
  const headline = escapeHtml(cfg.resume.headline || cfg.fileName || "Review before submit is on");
  const answerCount = countSavedAnswerSources(cfg.profile);
  return `
    <button class="aa-close" type="button" aria-label="Hide AutoApply">×</button>
    <div class="aa-kicker"><span class="aa-dot"></span>${labelForATS(ats)} job detected</div>
    <div class="aa-title">Apply from this page</div>
    <div class="aa-profile">
      <span class="aa-avatar">a/a</span>
      <span>
        <strong>${name}</strong>
        <small>${headline}</small>
      </span>
    </div>
    <button class="aa-primary" type="button">
      <span class="aa-primary-icon">✦</span>
      <span class="aa-primary-label">One-click apply</span>
      <span class="aa-arrow">→</span>
    </button>
    <div class="aa-status-row">
      <span>Resume ready</span>
      <span>${answerCount} saved ${answerCount === 1 ? "answer" : "answers"}</span>
      <span>Review on</span>
    </div>
    <div class="aa-footnote">Opens a live run and pauses before final submit.</div>
    <div class="aa-toast" role="status"></div>
  `;
}

function unpairedDockMarkup(ats: ATS): string {
  return `
    <button class="aa-close" type="button" aria-label="Hide AutoApply">×</button>
    <div class="aa-kicker"><span class="aa-dot"></span>${labelForATS(ats)} job detected</div>
    <div class="aa-title">Make this a one-click apply page</div>
    <p class="aa-copy">Pair your resume once, then apply directly from job descriptions.</p>
    <button class="aa-primary aa-primary-setup" type="button">
      <span class="aa-primary-icon">↗</span>
      <span class="aa-primary-label">Set up AutoApply</span>
    </button>
    <div class="aa-footnote">Setup takes one pairing step with the web app.</div>
    <div class="aa-toast" role="status"></div>
  `;
}

function findNativeApplyTarget(): HTMLElement | null {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>("a, button, [role='button'], input[type='submit']"),
  ).filter((element) => {
    if (element.id === INLINE_HOST_ID || element.closest(`#${INLINE_HOST_ID}, #${DOCK_HOST_ID}`)) {
      return false;
    }
    const text = getElementText(element);
    if (!/\bapply\b/i.test(text)) return false;
    if (/(autoapply|one-click|cookie|privacy|terms|filter|login|sign in)/i.test(text)) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 40 && rect.height > 20 && rect.bottom > 0 && rect.right > 0;
  });

  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => scoreApplyTarget(b) - scoreApplyTarget(a))[0];
}

function scoreApplyTarget(element: HTMLElement): number {
  const text = getElementText(element);
  const rect = element.getBoundingClientRect();
  let score = 0;
  if (/^apply\b/i.test(text)) score += 10;
  if (/apply (for|to)|submit application/i.test(text)) score += 8;
  if (element.tagName === "A" || element.tagName === "BUTTON") score += 3;
  if (rect.top >= 0 && rect.top < window.innerHeight * 0.8) score += 4;
  score += Math.min(rect.width, 260) / 80;
  return score;
}

function getElementText(element: HTMLElement): string {
  if (element instanceof HTMLInputElement) return element.value || element.ariaLabel || "";
  return `${element.innerText || element.textContent || ""} ${element.getAttribute("aria-label") ?? ""}`.trim();
}

function labelForATS(ats: ATS): string {
  if (ats === "greenhouse") return "Greenhouse";
  if (ats === "ashby") return "Ashby";
  return "Lever";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function inlineStatus(cfg: Extract<StoredConfig, { paired: true }>): string {
  const answerCount = countSavedAnswerSources(cfg.profile);
  return `Resume ready · ${answerCount} saved ${answerCount === 1 ? "answer" : "answers"} · Review on`;
}

function countSavedAnswerSources(profile: Extract<StoredConfig, { paired: true }>["profile"]): number {
  if (!profile) return 0;
  const learned = Object.values(profile.learnedAnswers ?? {}).filter((entry) =>
    Boolean(entry?.answer),
  ).length;
  const company = Object.values(profile.companyAnswers ?? {}).reduce((sum, group) => {
    return (
      sum +
      Object.values(group?.answers ?? {}).filter((entry) => Boolean(entry?.answer)).length
    );
  }, 0);
  return learned + company;
}

const STYLES = `
  :host, :host *, .aa-dock, .aa-dock *, .aa-inline, .aa-inline * {
    box-sizing: border-box;
    font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    letter-spacing: 0;
  }
  @keyframes aa-pop {
    from { opacity: 0; transform: translateY(10px) scale(0.96); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  @keyframes aa-spin { to { transform: rotate(360deg); } }
  .aa-dock {
    position: relative;
    width: min(330px, calc(100vw - 28px));
    padding: 16px;
    border-radius: 18px;
    color: #f8f4ec;
    background:
      linear-gradient(145deg, rgba(38, 37, 32, 0.96), rgba(13, 14, 12, 0.96)),
      radial-gradient(circle at 15% 0%, rgba(212, 255, 80, 0.18), transparent 45%);
    border: 1px solid rgba(212, 255, 80, 0.22);
    box-shadow:
      0 24px 70px rgba(0, 0, 0, 0.48),
      0 0 0 1px rgba(255, 255, 255, 0.04),
      0 0 46px rgba(212, 255, 80, 0.18);
    backdrop-filter: blur(18px) saturate(145%);
    -webkit-backdrop-filter: blur(18px) saturate(145%);
    animation: aa-pop 280ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .aa-close {
    position: absolute;
    top: 10px;
    right: 10px;
    width: 24px;
    height: 24px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.04);
    color: rgba(248, 244, 236, 0.62);
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
  }
  .aa-close:hover { color: #f8f4ec; border-color: rgba(212, 255, 80, 0.34); }
  .aa-kicker {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: calc(100% - 34px);
    padding: 4px 9px;
    border-radius: 999px;
    border: 1px solid rgba(212, 255, 80, 0.2);
    background: rgba(212, 255, 80, 0.08);
    color: #d4ff50;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
  }
  .aa-dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: #d4ff50;
    box-shadow: 0 0 14px rgba(212, 255, 80, 0.85);
  }
  .aa-title {
    margin-top: 11px;
    color: #f8f4ec;
    font-size: 20px;
    font-weight: 650;
    line-height: 1.12;
  }
  .aa-copy {
    margin: 8px 0 0;
    color: rgba(248, 244, 236, 0.68);
    font-size: 13px;
    line-height: 1.42;
  }
  .aa-profile {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr);
    gap: 10px;
    align-items: center;
    margin-top: 12px;
    padding: 10px;
    border-radius: 13px;
    background: rgba(255, 255, 255, 0.045);
    border: 1px solid rgba(255, 255, 255, 0.06);
  }
  .aa-avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border-radius: 999px;
    background: rgba(212, 255, 80, 0.13);
    border: 1px solid rgba(212, 255, 80, 0.28);
    color: #d4ff50;
    font-family: Georgia, serif;
    font-style: italic;
    font-size: 15px;
  }
  .aa-profile strong,
  .aa-profile small {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .aa-profile strong {
    color: #f8f4ec;
    font-size: 13px;
    font-weight: 650;
  }
  .aa-profile small {
    margin-top: 2px;
    color: rgba(248, 244, 236, 0.58);
    font-size: 11px;
  }
  .aa-primary,
  .aa-inline {
    appearance: none;
    border: 0;
    cursor: pointer;
    user-select: none;
  }
  .aa-primary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 9px;
    width: 100%;
    min-height: 46px;
    margin-top: 12px;
    padding: 12px 15px;
    border-radius: 14px;
    background: linear-gradient(135deg, #d4ff50, #f6d34a);
    color: #15170a;
    font-size: 14px;
    font-weight: 750;
    box-shadow: 0 14px 30px rgba(212, 255, 80, 0.22);
    transition: transform 180ms ease, box-shadow 180ms ease, opacity 180ms ease;
  }
  .aa-primary:hover {
    transform: translateY(-1px);
    box-shadow: 0 18px 38px rgba(212, 255, 80, 0.3);
  }
  .aa-primary:active { transform: translateY(0); }
  .aa-primary:disabled { opacity: 0.72; cursor: progress; transform: none; }
  .aa-primary-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 999px;
    background: rgba(21, 23, 10, 0.1);
  }
  .aa-arrow { margin-left: auto; font-size: 16px; }
  .aa-loading .aa-primary-icon,
  .aa-loading .aa-inline-spark {
    border: 2px solid rgba(21, 23, 10, 0.2);
    border-top-color: #15170a;
    color: transparent;
    animation: aa-spin 0.8s linear infinite;
  }
  .aa-footnote {
    margin-top: 9px;
    color: rgba(248, 244, 236, 0.56);
    font-size: 11px;
    line-height: 1.35;
    text-align: center;
  }
  .aa-status-row {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 5px;
    margin-top: 10px;
  }
  .aa-status-row span {
    display: inline-flex;
    align-items: center;
    min-height: 22px;
    padding: 4px 7px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.055);
    border: 1px solid rgba(255, 255, 255, 0.07);
    color: rgba(248, 244, 236, 0.7);
    font-size: 10px;
    font-weight: 650;
  }
  .aa-toast {
    position: absolute;
    left: 14px;
    right: 14px;
    bottom: calc(100% + 10px);
    padding: 10px 12px;
    border-radius: 12px;
    color: #fff;
    font-size: 12px;
    line-height: 1.35;
    opacity: 0;
    transform: translateY(8px);
    pointer-events: none;
    transition: opacity 180ms ease, transform 180ms ease;
    box-shadow: 0 14px 30px rgba(0, 0, 0, 0.28);
  }
  .aa-toast[data-kind="success"] {
    color: #15170a;
    background: #d4ff50;
  }
  .aa-toast[data-kind="error"] {
    background: rgba(210, 54, 54, 0.96);
  }
  .aa-toast-show {
    opacity: 1;
    transform: translateY(0);
  }
  .aa-inline {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 42px;
    max-width: min(420px, 100%);
    padding: 10px 14px;
    border-radius: 999px;
    background: #15170a;
    color: #f8f4ec;
    border: 1px solid rgba(212, 255, 80, 0.36);
    box-shadow:
      0 10px 24px rgba(0, 0, 0, 0.22),
      0 0 28px rgba(212, 255, 80, 0.16);
    font-size: 14px;
    font-weight: 720;
    line-height: 1;
    white-space: nowrap;
    transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease;
  }
  .aa-inline-text {
    display: inline-flex;
    min-width: 0;
    flex-direction: column;
    align-items: flex-start;
    gap: 3px;
  }
  .aa-inline-text strong,
  .aa-inline-text small {
    display: block;
    max-width: 270px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .aa-inline-text strong {
    color: inherit;
    font-size: 14px;
    font-weight: 760;
  }
  .aa-inline-text small {
    color: rgba(248, 244, 236, 0.64);
    font-size: 10px;
    font-weight: 650;
  }
  .aa-inline:hover {
    transform: translateY(-1px);
    border-color: rgba(212, 255, 80, 0.7);
    box-shadow:
      0 14px 30px rgba(0, 0, 0, 0.26),
      0 0 36px rgba(212, 255, 80, 0.24);
  }
  .aa-inline:disabled { opacity: 0.72; cursor: progress; transform: none; }
  .aa-inline-spark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 999px;
    background: #d4ff50;
    color: #15170a;
    font-size: 12px;
  }
  .aa-inline-ats {
    display: inline-flex;
    align-items: center;
    padding: 4px 7px;
    border-radius: 999px;
    background: rgba(212, 255, 80, 0.11);
    color: #d4ff50;
    font-size: 10px;
    font-weight: 750;
    text-transform: uppercase;
  }
  .aa-inline-setup {
    background: #f8f4ec;
    color: #15170a;
    border-color: rgba(21, 23, 10, 0.14);
  }
  @media (max-width: 640px) {
    .aa-dock {
      right: auto;
      width: calc(100vw - 24px);
      border-radius: 18px;
    }
    .aa-inline {
      width: 100%;
      white-space: normal;
      line-height: 1.2;
    }
  }
`;
