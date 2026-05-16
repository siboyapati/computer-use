import type { PairedConfig, StoredConfig } from "./types";

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
  return new Promise((resolve) => {
    chrome.storage.local.set({ [KEY]: config }, () => resolve());
  });
}

export async function clearConfig(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(KEY, () => resolve());
  });
}
