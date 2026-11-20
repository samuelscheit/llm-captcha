import { BUILTIN_ADAPTERS } from "../core/adapters";
import type { AdapterSpec, Settings } from "../core/types";

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  model: { provider: "openai-compatible", baseURL: "", apiKey: "", model: "" },
  fallbackModels: [],
  report: { enabled: false, token: "", repo: "", fixtureRepo: "", maxPerDay: 5 },
  maxRounds: 8,
  autoReload: true,
  denylist: [],
  customAdapters: [],
};

export async function loadSettings(): Promise<Settings> {
  const stored = (await chrome.storage.local.get("settings")).settings as Partial<Settings> | undefined;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    model: { ...DEFAULT_SETTINGS.model, ...stored?.model },
    report: { ...DEFAULT_SETTINGS.report, ...stored?.report },
  };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ settings });
}

/** User adapters first, so they win over a built-in on the same root. */
export function adaptersOf(settings: Settings): AdapterSpec[] {
  return [...settings.customAdapters, ...BUILTIN_ADAPTERS];
}

export function isDenied(settings: Settings, url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return settings.denylist.some((entry) => {
    const suffix = entry.trim().toLowerCase().replace(/^\*?\./, "");
    return !!suffix && (host === suffix || host.endsWith(`.${suffix}`));
  });
}
