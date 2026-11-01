import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  type ExtensionSettings,
} from "../core/types";
import { isPlainObject, normalizeSettings } from "../core/validators";

/**
 * 設定永続化・即時同期モジュール（FR-001, FR-050: spec.md 2.7）
 *
 * - chrome.storage.local を単一の情報源とする。
 * - tabs 権限を追加せずに全開いている X タブへ即時反映するため、
 *   chrome.storage.onChanged と runtime.onMessage(SETTINGS_CHANGED) の両方に対応する。
 */

export async function loadSettings(): Promise<ExtensionSettings> {
  try {
    const stored = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
    return normalizeSettings(stored[SETTINGS_STORAGE_KEY]);
  } catch {
    return normalizeSettings(DEFAULT_SETTINGS);
  }
}

export async function saveSettings(partialOrFull: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
  const current = await loadSettings();
  const merged = normalizeSettings({
    ...current,
    ...partialOrFull,
  });
  await chrome.storage.local.set({
    [SETTINGS_STORAGE_KEY]: merged,
  });
  return merged;
}

export async function resetSettings(): Promise<ExtensionSettings> {
  const clean = normalizeSettings(DEFAULT_SETTINGS);
  await chrome.storage.local.set({
    [SETTINGS_STORAGE_KEY]: clean,
  });
  return clean;
}

/**
 * 設定変更を購読し、解除関数を返す。
 * Options UI から保存された変更は、再読み込みなしで全 X タブの Content Script に即時通知される。
 */
export function subscribeSettingsChanged(
  onChange: (nextSettings: ExtensionSettings) => void,
): () => void {
  const handleStorageChange = (
    changes: { [key: string]: chrome.storage.StorageChange },
    areaName: string,
  ): void => {
    if (areaName !== "local") return;
    const change = changes[SETTINGS_STORAGE_KEY];
    if (!change) return;
    onChange(normalizeSettings(change.newValue));
  };

  const handleRuntimeMessage = (message: unknown): void => {
    if (isPlainObject(message) && message.type === "SETTINGS_CHANGED") {
      onChange(normalizeSettings(message.settings));
    }
  };

  chrome.storage.onChanged.addListener(handleStorageChange);
  chrome.runtime.onMessage.addListener(handleRuntimeMessage);

  return () => {
    chrome.storage.onChanged.removeListener(handleStorageChange);
    chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
  };
}
