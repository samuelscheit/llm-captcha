/**
 * Benchmark bookkeeping: which (model, fixture) pairs are stale, and the leaderboard per challenge
 * category. Pure functions; bench.ts does the I/O.
 */
import { createHash } from "node:crypto";
import type { ModelConfig, TokenUsage } from "../../core/types";
import type { StoredFixture } from "../fixtures";

/** A model on the leaderboard. Strings may reference environment variables as ${NAME}. */
export interface BenchModel extends ModelConfig {
  /** Leaderboard name, unique. */
  name: string;
}

/**
 * Every model an OpenAI-compatible gateway lists at `${baseURL}/models` joins the leaderboard
 * under its id, unless `exclude` matches it or `include` does not.
 */
export interface DiscoverSource {
  discover: { baseURL: string; apiKey: string; include?: string; exclude?: string };
}

export type ModelSource = BenchModel | DiscoverSource;

export interface BenchRun {
  pass: boolean;
  ms: number;
  at: string;
  problems?: string[];
  /** Tokens of the model call, when the provider reported them. */
  usage?: TokenUsage;
}

/** Runs of one model on one fixture, valid for exactly that fixture and solver. */
export interface BenchEntry {
  fixtureHash: string;
  solverHash: string;
  runs: BenchRun[];
}

export interface BenchResults {
  /** model name → fixture name → entry */
  models: Record<string, Record<string, BenchEntry>>;
  /** Models the provider refused for good (no image input, unknown model): not tried again. */
  unsupported?: Record<string, string>;
}

export const sha = (...parts: (string | Buffer)[]) => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest("hex").slice(0, 12);
};

export const fillEnv = (s: string, env: Record<string, string | undefined>) => s.replace(/\$\{(\w+)\}/g, (_, name: string) => env[name] ?? "");

/** Replace ${NAME} with the environment's value; a model whose key stays empty is skipped. */
export function resolveModels(models: BenchModel[], env: Record<string, string | undefined>): { ready: BenchModel[]; skipped: string[] } {
  const fill = (s: string) => fillEnv(s, env);
  const resolved = models.map((m) => ({ ...m, baseURL: fill(m.baseURL ?? ""), apiKey: fill(m.apiKey ?? ""), model: fill(m.model) }));
  return {
    ready: resolved.filter((m) => m.apiKey),
    skipped: resolved.filter((m) => !m.apiKey).map((m) => m.name),
  };
}

/**
 * Expand `discover` sources into models through the gateway's model list. An explicit model with a
 * key wins over a discovered one of the same name; one without a key gives way to it. Sources
 * without a URL or key are left out (`skipped`).
 */
export async function expandSources(
  sources: ModelSource[],
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch,
): Promise<{ models: BenchModel[]; skipped: string[] }> {
  const explicit = sources.filter((s): s is BenchModel => !("discover" in s));
  let models = [...explicit];
  const skipped: string[] = [];
  for (const source of sources) {
    if (!("discover" in source)) continue;
    const baseURL = fillEnv(source.discover.baseURL, env).replace(/\/$/, "");
    const apiKey = fillEnv(source.discover.apiKey, env);
    if (!baseURL || !apiKey) {
      skipped.push(`models of ${source.discover.baseURL || "a gateway"} (no URL or key)`);
      continue;
    }
    const response = await fetchImpl(`${baseURL}/models`, { headers: { authorization: `Bearer ${apiKey}` } });
    if (!response.ok) throw new Error(`model list of ${baseURL}: ${response.status}`);
    const { data } = (await response.json()) as { data: { id: string }[] };
    const include = source.discover.include ? new RegExp(source.discover.include) : undefined;
    const exclude = source.discover.exclude ? new RegExp(source.discover.exclude) : undefined;
    for (const { id } of data) {
      if ((include && !include.test(id)) || exclude?.test(id)) continue;
      const same = models.find((m) => m.name === id);
      if (same && fillEnv(same.apiKey ?? "", env)) continue;
      models = models.filter((m) => m !== same);
      models.push({ name: id, provider: "openai-compatible", model: id, baseURL, apiKey });
    }
  }
  return { models, skipped };
}

/** Models never measured (no results, not refused): what a monthly run adds. */
export const untested = (results: BenchResults, models: BenchModel[]) =>
  models.filter((m) => !results.models[m.name] && !results.unsupported?.[m.name]);

/**
 * A provider error that will not go away by retrying (bad request, no such model, no image
 * input), as opposed to rate limits, timeouts and outages.
 */
export const isPermanent = (status: number | undefined) => status !== undefined && status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status);

/** Challenge category of a fixture: provider and challenge kind, e.g. recaptcha/select. */
export const categoryOf = (fixture: Pick<StoredFixture, "name" | "view">) => `${fixture.name.split("/")[0]}/${fixture.view.kind}`;

export const fixtureHash = (fixture: StoredFixture) =>
  sha(JSON.stringify({ view: fixture.view, history: fixture.history, expected: fixture.expected }), ...fixture.frames);

/**
 * Pairs that need (more) runs: no entry, an entry for another version of the fixture or of the
 * solver, or fewer runs than asked for.
 */
export function staleJobs(results: BenchResults, models: BenchModel[], fixtures: StoredFixture[], solverHash: string, runs: number) {
  const jobs: { model: BenchModel; fixture: StoredFixture; missing: number }[] = [];
  for (const model of models) {
    for (const fixture of fixtures) {
      const entry = results.models[model.name]?.[fixture.name];
      const current = entry && entry.fixtureHash === fixtureHash(fixture) && entry.solverHash === solverHash;
      const missing = runs - (current ? entry.runs.length : 0);
      if (missing > 0) jobs.push({ model, fixture, missing });
    }
  }
  return jobs;
}

/** Add a run, replacing an entry that belonged to another fixture or solver version. */
export function record(results: BenchResults, model: string, fixture: StoredFixture, solverHash: string, run: BenchRun): void {
  const byFixture = (results.models[model] ??= {});
  const hash = fixtureHash(fixture);
  const entry = byFixture[fixture.name];
  if (!entry || entry.fixtureHash !== hash || entry.solverHash !== solverHash) byFixture[fixture.name] = { fixtureHash: hash, solverHash, runs: [run] };
  else entry.runs.push(run);
}

export interface Cell {
  passed: number;
  total: number;
}

export interface Row {
  model: string;
  overall: Cell;
  categories: Record<string, Cell>;
  medianMs: number;
  /** Latest run, ISO. */
  measuredAt: string;
  /** Solver versions the counted runs were measured with. */
  solvers: string[];
  /** Median tokens per run, over the runs that reported usage. */
  tokens?: { input: number; output: number };
  /** USD at API list price: mean per run, and spent per solved run (all runs ÷ passed ones). */
  cost?: { perRun: number; perSolve: number | undefined };
}

/** USD of one model call, or undefined for an unknown model (see pricing.ts). */
export type Pricer = (model: string, usage: TokenUsage) => number | undefined;

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

/**
 * One row per model over the current fixtures: every run counts, so a fixture solved in 2 of 3
 * runs adds 2/3. Results of an older solver still count (the weekly run only measures new
 * models); each row names the solver versions behind it. Results for an older version of a
 * fixture do not. Models without runs are left out; best overall first. Tokens and cost come from
 * the runs that reported usage (older results have none), priced by `price`.
 */
export function leaderboard(results: BenchResults, models: string[], fixtures: StoredFixture[], price?: Pricer): Row[] {
  const rows: Row[] = [];
  for (const model of models) {
    const overall: Cell = { passed: 0, total: 0 };
    const categories: Record<string, Cell> = {};
    const times: number[] = [];
    const solvers = new Set<string>();
    const metered: { usage: TokenUsage; pass: boolean }[] = [];
    let measuredAt = "";
    for (const fixture of fixtures) {
      const entry = results.models[model]?.[fixture.name];
      if (!entry || entry.fixtureHash !== fixtureHash(fixture)) continue;
      solvers.add(entry.solverHash);
      const cell = (categories[categoryOf(fixture)] ??= { passed: 0, total: 0 });
      for (const run of entry.runs) {
        cell.total++;
        overall.total++;
        if (run.pass) {
          cell.passed++;
          overall.passed++;
        }
        times.push(run.ms);
        if (run.usage) metered.push({ usage: run.usage, pass: run.pass });
        if (run.at > measuredAt) measuredAt = run.at;
      }
    }
    if (overall.total) rows.push({ model, overall, categories, medianMs: median(times), measuredAt, solvers: [...solvers].sort(), ...usageOf(model, metered, price) });
  }
  const rate = (c: Cell) => c.passed / c.total;
  return rows.sort((a, b) => rate(b.overall) - rate(a.overall) || a.medianMs - b.medianMs);
}

function usageOf(model: string, metered: { usage: TokenUsage; pass: boolean }[], price?: Pricer): Pick<Row, "tokens" | "cost"> {
  if (!metered.length) return {};
  const tokens = { input: median(metered.map((m) => m.usage.input)), output: median(metered.map((m) => m.usage.output)) };
  const prices = price ? metered.map((m) => price(model, m.usage)) : [];
  if (!prices.length || prices.some((p) => p === undefined)) return { tokens };
  const total = prices.reduce((sum, p) => sum! + p!, 0)!;
  const solved = metered.filter((m) => m.pass).length;
  return { tokens, cost: { perRun: total / metered.length, perSolve: solved ? total / solved : undefined } };
}

/** USD with two significant digits, never in exponent notation: $0.0042, $0.12, $1.50. */
export const usd = (x: number | undefined) =>
  x === undefined ? "–" : `$${x >= 1 || x === 0 ? x.toFixed(2) : x.toFixed(Math.max(2, 1 - Math.floor(Math.log10(x))))}`;

/** Token counts: 812, 3.4k. */
export const count = (n: number) => (n < 1000 ? `${Math.round(n)}` : `${(n / 1000).toFixed(1)}k`);

const pct = (c: Cell | undefined) => (c ? `${Math.round((100 * c.passed) / c.total)}% (${c.passed}/${c.total})` : "–");

export function renderLeaderboard(rows: Row[], fixtures: StoredFixture[], solverHash: string, skipped: string[]): string {
  const categories = [...new Set(fixtures.map(categoryOf))].sort();
  const counts = Object.fromEntries(categories.map((c) => [c, fixtures.filter((f) => categoryOf(f) === c).length]));
  const updated = rows.map((r) => r.measuredAt).sort().at(-1)?.slice(0, 10) ?? "never";
  return [
    "# Benchmark",
    "",
    "How often each model solves the labeled real-world challenges in [`fixtures/`](fixtures/), replayed exactly as the solver asks live: same screenshots, labels, motion analysis and prompt. A run passes when its answer equals the labeled one. Every run counts, so a fixture solved in 2 of 3 runs adds 2/3.",
    "",
    "Where the labels come from: most are answers the vendor itself accepted live (`capture --accept`); those answers came from the model that captured them (claude-opus-5-5), so a different but equally valid answer, such as another click order or a point off the item's centre, can count as a miss. The rest were labeled by hand from the screenshots, including cases the vendor rejected; unsure ones stay unlabeled.",
    "",
    `Updated ${updated} · ${fixtures.length} fixtures · current solver \`${solverHash}\` · generated by \`bun run bench\`; new models are measured weekly by CI.`,
    "",
    `| Model | Overall | ${categories.map((c) => `${c} (${counts[c]})`).join(" | ")} | Median time | Tokens in / out | Cost / run | Cost / solve | Solver |`,
    `|---|---|${categories.map(() => "---|").join("")}---|---|---|---|---|`,
    ...rows.map(
      (r) =>
        `| ${r.model} | **${pct(r.overall)}** | ${categories.map((c) => pct(r.categories[c])).join(" | ")} | ${(r.medianMs / 1000).toFixed(1)}s | ${r.tokens ? `${count(r.tokens.input)} / ${count(r.tokens.output)}` : "–"} | ${usd(r.cost?.perRun)} | ${usd(r.cost?.perSolve)} | ${r.solvers.map((s) => `\`${s}\``).join(", ")} |`,
    ),
    "",
    "Tokens are the median per run as the provider reported them (output includes reasoning). Cost is at the provider's API list price ([genai-prices](https://github.com/pydantic/genai-prices)), not what a gateway or plan bills, with all input uncached as on a live challenge: per run on average, and per solve, which is everything spent ÷ runs passed, so failed attempts count against it.",
    "",
    rows.length ? "" : "_No results for the current fixtures and solver yet._\n",
    skipped.length ? `Not measured (no API key in this run): ${skipped.join(", ")}.\n` : "",
    "Add a model to [`benchmarks/models.json`](benchmarks/models.json); add challenges by labeling fixtures (see [AGENTS.md](AGENTS.md)).",
    "",
  ]
    .filter((line, i, all) => !(line === "" && all[i - 1] === ""))
    .join("\n");
}
