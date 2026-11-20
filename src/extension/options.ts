import { BUILTIN_ADAPTERS } from "../core/adapters";
import { formatAction } from "../core/prompt";
import type { AdapterSpec, LogEntry, ModelConfig, ProviderKind, Settings } from "../core/types";
import type { ReportEntry } from "./background";
import type { Message } from "./messages";
import { loadSettings, saveSettings } from "./settings";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const field = (id: string) => $<HTMLInputElement>(id);

function show(out: HTMLOutputElement, text: string, ok: boolean): void {
  out.textContent = text;
  out.className = ok ? "ok" : "bad";
}

function modelFromForm(): ModelConfig {
  return {
    provider: $<HTMLSelectElement>("provider").value as ProviderKind,
    baseURL: field("baseURL").value.trim(),
    apiKey: field("apiKey").value.trim(),
    model: field("model").value.trim(),
  };
}

function fill(s: Settings): void {
  field("enabled").checked = s.enabled;
  $<HTMLSelectElement>("provider").value = s.model.provider;
  field("baseURL").value = s.model.baseURL;
  field("apiKey").value = s.model.apiKey;
  field("model").value = s.model.model;
  field("maxRounds").value = String(s.maxRounds);
  field("autoReload").checked = s.autoReload;
  $<HTMLTextAreaElement>("denylist").value = s.denylist.join("\n");
  $<HTMLTextAreaElement>("customAdapters").value = s.customAdapters.length ? JSON.stringify(s.customAdapters, null, 2) : "";
  // One model per line: a model is a short record, pretty-printing would hide all but the first.
  $<HTMLTextAreaElement>("fallbackModels").value = s.fallbackModels.length ? `[\n${s.fallbackModels.map((m) => `  ${JSON.stringify(m)}`).join(",\n")}\n]` : "";
  field("reportEnabled").checked = s.report.enabled;
  field("reportRepo").value = s.report.repo;
  field("reportFixtureRepo").value = s.report.fixtureRepo;
  field("reportToken").value = s.report.token;
  field("reportMaxPerDay").value = String(s.report.maxPerDay);
}

function parseModels(text: string): ModelConfig[] {
  if (!text.trim()) return [];
  const parsed = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed) || parsed.some((m) => !m?.provider || !m?.model)) throw new Error("Fallback models must be a JSON array of {provider, baseURL, apiKey, model}.");
  return parsed.map((m: ModelConfig) => ({ provider: m.provider, baseURL: m.baseURL ?? "", apiKey: m.apiKey ?? "", model: m.model }));
}

const REPO = /^[\w.-]+\/[\w.-]+$/;

function parseAdapters(text: string): AdapterSpec[] {
  if (!text.trim()) return [];
  const parsed = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Custom adapters must be a JSON array.");
  for (const a of parsed as AdapterSpec[]) {
    if (!a.id || !a.kind || !a.root || !Array.isArray(a.targets)) throw new Error(`Adapter ${a.id ?? "?"} needs id, kind, root and targets.`);
  }
  return parsed as AdapterSpec[];
}

async function save(): Promise<void> {
  const out = $<HTMLOutputElement>("saveResult");
  try {
    const current = await loadSettings();
    await saveSettings({
      ...current,
      enabled: field("enabled").checked,
      model: modelFromForm(),
      maxRounds: Math.max(1, Number(field("maxRounds").value) || current.maxRounds),
      autoReload: field("autoReload").checked,
      denylist: $<HTMLTextAreaElement>("denylist").value.split("\n").map((s) => s.trim()).filter(Boolean),
      customAdapters: parseAdapters($<HTMLTextAreaElement>("customAdapters").value),
      fallbackModels: parseModels($<HTMLTextAreaElement>("fallbackModels").value),
      report: {
        enabled: field("reportEnabled").checked,
        repo: field("reportRepo").value.trim(),
        fixtureRepo: field("reportFixtureRepo").value.trim(),
        token: field("reportToken").value.trim(),
        maxPerDay: Math.max(0, Number(field("reportMaxPerDay").value) || 0),
      },
    });
    const repo = field("reportRepo").value.trim();
    const fixtureRepo = field("reportFixtureRepo").value.trim();
    if (field("reportEnabled").checked && (!REPO.test(repo) || (fixtureRepo && !REPO.test(fixtureRepo)) || !field("reportToken").value.trim())) {
      return show(out, "Saved, but reports need a token and repositories as owner/name.", false);
    }
    show(out, "Saved", true);
  } catch (error) {
    show(out, (error as Error).message, false);
  }
}

async function test(): Promise<void> {
  const button = $<HTMLButtonElement>("test");
  const out = $<HTMLOutputElement>("testResult");
  button.disabled = true;
  out.textContent = "Asking the model…";
  out.className = "";
  const reply = (await chrome.runtime.sendMessage({ type: "test-model", model: modelFromForm() } satisfies Message)) as { ok: boolean; text: string };
  show(out, reply.ok ? `Model answered: ${reply.text}` : reply.text, reply.ok);
  button.disabled = false;
}

async function renderLog(): Promise<void> {
  const { log = [] } = (await chrome.storage.local.get("log")) as { log?: LogEntry[] };
  const body = $<HTMLTableSectionElement>("log");
  body.replaceChildren();
  if (!log.length) {
    const row = body.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 5;
    cell.className = "empty";
    cell.textContent = "No rounds yet.";
    return;
  }
  for (const entry of log.slice().reverse()) {
    const row = body.insertRow();
    row.insertCell().textContent = new Date(entry.time).toLocaleTimeString();
    const page = row.insertCell();
    page.className = "page";
    page.textContent = page.title = entry.url;
    row.insertCell().textContent = entry.adapter;
    row.insertCell().textContent = `${entry.round} · ${(entry.ms / 1000).toFixed(1)}s`;
    const result = row.insertCell();
    result.textContent = entry.error ?? entry.actions.map(formatAction).join("; ");
    result.title = entry.reasoning;
  }
}

async function renderReports(): Promise<void> {
  const { reports = [] } = (await chrome.storage.local.get("reports")) as { reports?: ReportEntry[] };
  $("reports").replaceChildren(
    ...reports
      .slice(-10)
      .reverse()
      .map((r) => {
        const li = document.createElement("li");
        const time = `${new Date(r.time).toLocaleString()} · `;
        if (r.url) {
          const a = document.createElement("a");
          a.href = r.url;
          a.target = "_blank";
          a.textContent = r.title;
          li.append(time, a);
        } else {
          li.className = "bad";
          li.textContent = `${time}${r.title}: not reported (${r.error})`;
        }
        return li;
      }),
  );
}

$<HTMLPreElement>("builtins").textContent = JSON.stringify(BUILTIN_ADAPTERS, null, 2);
chrome.storage.onChanged.addListener((changes) => changes.reports && renderReports());
void renderReports();
$("save").addEventListener("click", save);
$("test").addEventListener("click", test);
chrome.storage.onChanged.addListener((changes) => changes.log && renderLog());
void loadSettings().then(fill);
void renderLog();
