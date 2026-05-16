/**
 * Background service worker.
 *
 * Two responsibilities:
 *   1. Accept the one-time "pair" message from the AutoApply web app's
 *      /connect page (via externally_connectable) and save the résumé +
 *      apiBase to chrome.storage.local.
 *   2. Accept "apply" messages from the content-script floating button,
 *      hit /api/start on the configured server, open a new tab pointing at
 *      the live-run UI.
 */

import { loadConfig, saveConfig } from "~lib/storage";
import { startApplication, liveRunUrl } from "~lib/api";
import type { ApplyMessage, PairMessage, StatusMessage } from "~lib/types";

// ──────────────────────────────────────────────────────────────────────────
// External messages from the web app's /connect page
// ──────────────────────────────────────────────────────────────────────────

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  void (async () => {
    try {
      if (!isPairMessage(message)) {
        sendResponse({ ok: false, error: "Unknown message type" });
        return;
      }
      const { resume, pdfBase64, fileName, apiBase } = message;
      if (!resume || !pdfBase64 || !apiBase) {
        sendResponse({ ok: false, error: "Missing resume / pdfBase64 / apiBase" });
        return;
      }
      await saveConfig({
        paired: true,
        apiBase: apiBase.replace(/\/+$/, ""),
        resume,
        pdfBase64,
        fileName: fileName ?? "résumé.pdf",
        pairedAt: Date.now(),
      });
      // Tell content scripts to re-evaluate (in case the user already had a job tab open)
      try {
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
          if (tab.id !== undefined) {
            chrome.tabs.sendMessage(tab.id, { type: "config-changed" }).catch(() => {});
          }
        }
      } catch {
        // ignore
      }
      sendResponse({ ok: true });
    } catch (err) {
      sendResponse({
        ok: false,
        error: err instanceof Error ? err.message : "Pairing failed",
      });
    }
  })();
  // Returning true tells Chrome we'll call sendResponse asynchronously.
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
// Internal messages from popup / content scripts
// ──────────────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void (async () => {
    try {
      if (isApplyMessage(message)) {
        const config = await loadConfig();
        if (!config.paired) {
          sendResponse({ ok: false, error: "Extension is not paired with the web app yet." });
          return;
        }
        const result = await startApplication(config, message.jobUrl);
        await chrome.tabs.create({
          url: liveRunUrl(config.apiBase, result.runId),
          active: true,
        });
        sendResponse({ ok: true, runId: result.runId });
        return;
      }
      if (isStatusMessage(message)) {
        const config = await loadConfig();
        sendResponse({ ok: true, config });
        return;
      }
      sendResponse({ ok: false, error: "Unknown message" });
    } catch (err) {
      sendResponse({
        ok: false,
        error: err instanceof Error ? err.message : "Background error",
      });
    }
  })();
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
// First-install: open the options page so the user can pair
// ──────────────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.runtime.openOptionsPage().catch(() => {});
  }
});

function isPairMessage(m: unknown): m is PairMessage {
  return typeof m === "object" && m !== null && (m as { type?: string }).type === "pair";
}

function isApplyMessage(m: unknown): m is ApplyMessage {
  return (
    typeof m === "object" &&
    m !== null &&
    (m as { type?: string }).type === "apply" &&
    typeof (m as { jobUrl?: unknown }).jobUrl === "string"
  );
}

function isStatusMessage(m: unknown): m is StatusMessage {
  return typeof m === "object" && m !== null && (m as { type?: string }).type === "get-status";
}
