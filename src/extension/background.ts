import { BUILD } from "../core/build-info.generated";
import { solve, type SolveResult } from "../core/engine";
import { isReportable, reportToGitHub } from "../core/github";
import { createModel, testModel } from "../core/solver";
import type { LogEntry, RoundRecord, Settings } from "../core/types";
import { ExtensionDriver } from "./driver";
import type { Message } from "./messages";
import { adaptersOf, isDenied, loadSettings } from "./settings";

const LOG_SIZE = 200;
const RECORDS_KEPT = 30;
const running = new Set<number>();
/** Tabs that woke the worker while a run was ending; they get another run. */
const woken = new Set<number>();
/** Tabs whose last run failed: no more (paid) runs until the tab navigates. */
const failed = new Set<number>();
/** Recent rounds with screenshots, for the fixture capture script. */
const records: RoundRecord[] = [];

const configuredModels = (settings: Settings) => [settings.model, ...settings.fallbackModels].filter((m) => m.model);

async function appendLog(entry: LogEntry): Promise<void> {
  const { log = [] } = (await chrome.storage.local.get("log")) as { log?: LogEntry[] };
  await chrome.storage.local.set({ log: [...log, entry].slice(-LOG_SIZE) });
}

/** One report filed (or failed to file), shown in the options page. */
export interface ReportEntry {
  time: number;
  title: string;
  url?: string;
  error?: string;
}

/** File a GitHub issue for a failure, at most `maxPerDay` per day. */
async function report(settings: Settings, result: SolveResult, pageUrl: string): Promise<void> {
  const config = settings.report;
  if (!config.enabled || !config.token || !config.repo || !isReportable(result)) return;
  const day = new Date().toISOString().slice(0, 10);
  const { reportQuota = { day, count: 0 }, reports = [] } = (await chrome.storage.local.get(["reportQuota", "reports"])) as {
    reportQuota?: { day: string; count: number };
    reports?: ReportEntry[];
  };
  const quota = reportQuota.day === day ? reportQuota : { day, count: 0 };
  if (quota.count >= config.maxPerDay) return;
  await chrome.storage.local.set({ reportQuota: { day, count: quota.count + 1 } });
  const entry: ReportEntry = { time: Date.now(), title: result.detail };
  try {
    entry.url = await reportToGitHub(config, { result, url: pageUrl, model: configuredModels(settings)[0]?.model ?? "", build: BUILD.commit });
  } catch (error) {
    entry.error = error instanceof Error ? error.message : String(error);
  }
  await chrome.storage.local.set({ reports: [...reports, entry].slice(-50) });
}

async function run(tabId: number): Promise<void> {
  if (failed.has(tabId)) return;
  if (running.has(tabId)) return void woken.add(tabId);
  running.add(tabId);
  woken.delete(tabId);
  const driver = new ExtensionDriver(tabId);
  try {
    const settings = await loadSettings();
    const pageUrl = await driver.url();
    if (!settings.enabled || isDenied(settings, pageUrl)) return;
    const models = configuredModels(settings).map(createModel);
    const result = await solve(driver, {
      adapters: adaptersOf(settings),
      models,
      maxRounds: settings.maxRounds,
      // Without a model the driving agent or person answers in the page (assist mode): give them time.
      timeoutMs: models.length ? 180_000 : 600_000,
      onRound(record) {
        records.push(record);
        records.splice(0, records.length - RECORDS_KEPT);
        const { view: _v, history: _h, frames: _f, labeled: _l, errorsAfter: _e, ...entry } = record;
        void appendLog(entry);
      },
    });
    if (result.state === "failed") {
      failed.add(tabId);
      void report(settings, result, pageUrl);
    }
  } catch (error) {
    console.error("captcha solver", error);
    failed.add(tabId);
    await driver.publish("failed", error instanceof Error ? error.message : String(error)).catch(() => {});
  } finally {
    await driver.close();
    running.delete(tabId);
  }
  if (woken.has(tabId)) void run(tabId);
  else void reloadIfRebuilt();
}

/**
 * Self-update: the extension runs unpacked from a git checkout that the updater rebuilds
 * (src/tools/update.ts). Its own files are read from disk, so build.json shows the new build; the
 * worker reloads into it once no solve is running.
 */
async function reloadIfRebuilt(): Promise<void> {
  if (running.size || !(await loadSettings()).autoReload) return;
  let onDisk: { id?: string } | undefined;
  try {
    onDisk = await (await fetch(chrome.runtime.getURL("build.json"), { cache: "no-store" })).json();
  } catch {
    return; // Mid-swap: next alarm.
  }
  if (onDisk?.id && onDisk.id !== BUILD.id) chrome.runtime.reload();
}
chrome.alarms.create("rebuilt", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => alarm.name === "rebuilt" && void reloadIfRebuilt());

chrome.runtime.onMessage.addListener((message: Message, sender, respond) => {
  if (message.type === "wake" && sender.tab?.id !== undefined) void run(sender.tab.id);
  if (message.type === "test-model") {
    testModel(message.model).then(
      (text) => respond({ ok: true, text }),
      (error: Error) => respond({ ok: false, text: error.message }),
    );
    return true;
  }
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "loading") failed.delete(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  running.delete(tabId);
  woken.delete(tabId);
  failed.delete(tabId);
});

/** Hooks for tests, reached through the service worker's evaluate. */
Object.assign(globalThis, { __captchaDebug: { records, run, reloadIfRebuilt, build: BUILD } });
