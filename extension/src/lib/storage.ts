import type { ActiveRun, PairedConfig, RunMetadata, RunStatus, StoredConfig, UserKeys } from "./types";

const KEY = "autoapply.config.v1";
const KEY_ACTIVE_RUN = "autoapply.activeRun.v1";
const ACTIVE_RUN_MAX_AGE_MS = 1000 * 60 * 60 * 2;

export async function loadConfig(): Promise<StoredConfig> {
  return new Promise((resolve) => {
    chrome.storage.local.get(KEY, (items) => {
      const v = items?.[KEY] as StoredConfig | undefined;
      resolve(v ?? { paired: false });
    });
  });
}

export async function saveConfig(config: PairedConfig): Promise<void> {
  const existing = await loadConfig();
  const userKeys: UserKeys = {
    ...existing.userKeys,
    ...config.userKeys,
  };
  for (const k of Object.keys(userKeys) as (keyof UserKeys)[]) {
    if (!userKeys[k]) delete userKeys[k];
  }
  const next: PairedConfig = {
    ...config,
    userKeys: Object.keys(userKeys).length > 0 ? userKeys : undefined,
    profile: config.profile ?? (existing.paired ? existing.profile : undefined),
  };
  return new Promise((resolve) => {
    chrome.storage.local.set({ [KEY]: next }, () => resolve());
  });
}

export async function clearConfig(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(KEY, () => resolve());
  });
}

export async function loadActiveRun(): Promise<ActiveRun | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(KEY_ACTIVE_RUN, (items) => {
      const value = items?.[KEY_ACTIVE_RUN] as ActiveRun | undefined;
      if (!value?.runId || !value.jobUrl || !value.ats || !value.status) {
        resolve(null);
        return;
      }
      if (
        isTerminalRunStatus(value.status) ||
        Date.now() - (value.updatedAt || value.startedAt || 0) > ACTIVE_RUN_MAX_AGE_MS
      ) {
        chrome.storage.local.remove(KEY_ACTIVE_RUN, () => resolve(null));
        return;
      }
      resolve(value);
    });
  });
}

export async function saveActiveRun(run: ActiveRun): Promise<void> {
  if (isTerminalRunStatus(run.status)) {
    await clearActiveRun();
    return;
  }
  return new Promise((resolve) => {
    chrome.storage.local.set(
      { [KEY_ACTIVE_RUN]: { ...run, updatedAt: Date.now() } },
      () => resolve(),
    );
  });
}

export async function clearActiveRun(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(KEY_ACTIVE_RUN, () => resolve());
  });
}

export function activeRunFromMeta(meta: RunMetadata): ActiveRun {
  return {
    runId: meta.runId,
    jobUrl: meta.jobUrl,
    ats: meta.ats,
    liveUrl: meta.liveUrl,
    company: meta.company,
    status: meta.status,
    startedAt: meta.startedAt,
    updatedAt: Date.now(),
  };
}

export function isTerminalRunStatus(status: RunStatus): boolean {
  return status === "submitted" || status === "failed" || status === "stopped";
}

/**
 * Persist a partial userKeys update. Merges with whatever's already in
 * storage so the user can save keys before pairing (the keys live under
 * the same config key — either paired or unpaired).
 */
export async function updateUserKeys(patch: UserKeys): Promise<void> {
  const existing = await loadConfig();
  const merged: UserKeys = {
    anthropic: patch.anthropic ?? existing.userKeys?.anthropic,
    google: patch.google ?? existing.userKeys?.google,
    steel: patch.steel ?? existing.userKeys?.steel,
  };
  // Drop empty strings so removed keys don't shadow env-var fallbacks.
  for (const k of Object.keys(merged) as (keyof UserKeys)[]) {
    if (!merged[k]) delete merged[k];
  }
  const next: StoredConfig =
    existing.paired === true
      ? { ...existing, userKeys: merged }
      : { paired: false, userKeys: merged };
  return new Promise((resolve) => {
    chrome.storage.local.set({ [KEY]: next }, () => resolve());
  });
}

/** Mask a key for display: first 4 + last 4 with ellipsis in between. */
export function maskKey(key: string | undefined): string {
  if (!key) return "—";
  const t = key.trim();
  if (t.length <= 10) return "•".repeat(t.length);
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}
