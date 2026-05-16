import type { ATS } from "./types";

/**
 * Mirror of detectATS in the web app. Keep in sync if the web app changes
 * supported hosts.
 */
export function detectATS(url: string): ATS | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host.endsWith(".lever.co") || host === "lever.co") return "lever";
    if (host.endsWith(".greenhouse.io") || host === "greenhouse.io") return "greenhouse";
    if (host.endsWith(".ashbyhq.com") || host === "ashbyhq.com") return "ashby";
    return null;
  } catch {
    return null;
  }
}

/**
 * A URL like `https://jobs.lever.co/` (just the host) is not a posting.
 * Require at least 2 path segments to qualify.
 */
export function isLikelyValidPostingUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.pathname.split("/").filter(Boolean).length >= 2;
  } catch {
    return false;
  }
}
