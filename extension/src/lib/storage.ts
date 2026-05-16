import type { PairedConfig, StoredConfig, UserKeys } from "./types";

const KEY = "autoapply.config.v1";

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
