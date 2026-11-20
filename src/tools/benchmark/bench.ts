/**
 * Benchmark the models of benchmarks/models.json (or benchmarks/models.local.json, if present) on
 * the labeled fixtures; render the leaderboard into BENCHMARK.md, benchmarks/leaderboard.svg and out/site/index.html (GitHub Pages).
 *
 *   bun run bench [--runs N] [--model name] [--concurrency N] [--new-only] [--force]
 *
 * Incremental: only (model, fixture) pairs whose fixture or solver changed since their last runs,
 * or that have fewer than N runs, are replayed. `--new-only` measures only models without any
 * results yet, e.g. what a gateway (a `discover` entry) started offering since the last run.
 * Results live in benchmarks/results.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { createModel } from "../../core/solver";
import { loadFixtures } from "../fixtures";
import {
  expandSources,
  isPermanent,
  leaderboard,
  record,
  renderLeaderboard,
  resolveModels,
  sha,
  staleJobs,
  untested,
  type BenchModel,
  type BenchResults,
  type ModelSource,
} from "./benchmark";
import { replay } from "../replay";
import { renderSite, renderSvg } from "./site";

const root = path.resolve(import.meta.dirname, "../../..");
const dir = path.join(root, "benchmarks");
const RESULTS = path.join(dir, "results.json");
/** What shapes a model's input and its scoring: a change here makes every result stale. */
const SOLVER_FILES = ["src/core/prompt.ts", "src/core/solver.ts", "src/core/engine.ts", "src/core/score.ts", "src/page/image.ts"];

const { values } = parseArgs({
  options: {
    runs: { type: "string", default: "2" },
    model: { type: "string" },
    concurrency: { type: "string", default: "6" },
    "new-only": { type: "boolean", default: false },
    /** Only report whether untested models exist (exit code 0: yes, 3: none); for CI to stop early. */
    "list-new": { type: "boolean", default: false },
    force: { type: "boolean", default: false },
  },
});

const configFile = existsSync(path.join(dir, "models.local.json")) ? "models.local.json" : "models.json";
const sources = JSON.parse(readFileSync(path.join(dir, configFile), "utf8")) as ModelSource[];
const expanded = await expandSources(sources, process.env);
const resolved = resolveModels(expanded.models.filter((m) => !values.model || m.name === values.model), process.env);
const skipped = [...expanded.skipped, ...resolved.skipped];
const fixtures = loadFixtures();
const solverHash = sha(...SOLVER_FILES.map((f) => readFileSync(path.join(root, f))));
const results: BenchResults = existsSync(RESULTS) && !values.force ? JSON.parse(readFileSync(RESULTS, "utf8")) : { models: {} };
const runs = Number(values.runs);
// Results of fixtures that were removed are dead weight.
for (const byFixture of Object.values(results.models)) {
  for (const name of Object.keys(byFixture)) if (!fixtures.some((f) => f.name === name)) delete byFixture[name];
}
const ready = (values["new-only"] || values["list-new"] ? untested(results, resolved.ready) : resolved.ready).filter((m) => !results.unsupported?.[m.name]);
if (values["list-new"]) {
  console.log(ready.length ? `untested models: ${ready.map((m) => m.name).join(", ")}` : "no untested models");
  process.exit(ready.length ? 0 : 3);
}

const stale = staleJobs(results, ready, fixtures, solverHash, runs);
console.log(`${configFile}: ${ready.length} models to measure, ${fixtures.length} fixtures, solver ${solverHash}; ${stale.reduce((n, j) => n + j.missing, 0)} runs to do`);
if (skipped.length) console.log(`skipped (no API key): ${skipped.join(", ")}`);

const save = () => writeFileSync(RESULTS, `${JSON.stringify(results, null, 1)}\n`);
const jobs = stale.flatMap(({ model, fixture, missing }) => Array.from({ length: missing }, (_, run) => ({ model, fixture, run })));
// Results are saved as they land: an interrupted benchmark resumes where it stopped.
await replay(jobs, (m: BenchModel) => createModel(m), {
  concurrency: Number(values.concurrency),
  onResult(r) {
    if (r.infra) {
      // Refused for good (no image input, no such model) before it ever answered: never again.
      if (isPermanent(r.status) && !results.models[r.model.name]) {
        (results.unsupported ??= {})[r.model.name] = r.problems.join("; ").slice(0, 200);
        save();
      }
      // Otherwise an outage is not the model's answer: leave the pair stale, the next run retries.
      return console.log(`SKIP ${r.model.name} ${r.fixture.name}: ${r.problems.join("; ").slice(0, 160)}`);
    }
    record(results, r.model.name, r.fixture, solverHash, { pass: r.pass, ms: r.ms, at: new Date().toISOString(), ...(r.pass ? {} : { problems: r.problems }) });
    save();
    console.log(`${r.pass ? "PASS" : "FAIL"} ${r.model.name} ${r.fixture.name} (${(r.ms / 1000).toFixed(1)}s)${r.pass ? "" : ` ${r.problems.join("; ")}`}`);
  },
});

// Everything with current results is on the board, measured in this run or before.
const rows = leaderboard(results, Object.keys(results.models), fixtures);
const notMeasured = skipped.filter((name) => !rows.some((r) => r.model === name));
writeFileSync(path.join(root, "BENCHMARK.md"), renderLeaderboard(rows, fixtures, solverHash, notMeasured));
mkdirSync(path.join(root, "out/site"), { recursive: true });
writeFileSync(path.join(root, "out/site/index.html"), renderSite(rows, fixtures, solverHash, results.unsupported ?? {}));
writeFileSync(path.join(dir, "leaderboard.svg"), renderSvg(rows, fixtures));
save();
console.log(`\n${readFileSync(path.join(root, "BENCHMARK.md"), "utf8")}`);
