/**
 * Render everything the leaderboard publishes from what is stored: BENCHMARK.md (models per
 * challenge category, then coverage per provider), benchmarks/leaderboard.svg (README) and
 * out/site/index.html (GitHub Pages). Shared by bench.ts and record-verified.ts.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BUILTIN_ADAPTERS } from "../../core/adapters";
import { loadFixtures } from "../fixtures";
import { leaderboard, renderLeaderboard, sha, type BenchResults } from "./benchmark";
import { coverage, renderCoverage, type Verified } from "./coverage";
import { priceOf } from "./pricing";
import { renderSite, renderSvg } from "./site";

export const ROOT = path.resolve(import.meta.dirname, "../../..");
export const RESULTS_FILE = path.join(ROOT, "benchmarks/results.json");
export const VERIFIED_FILE = path.join(ROOT, "benchmarks/verified.json");
/** What shapes a model's input and its scoring: a change here makes every result stale. */
export const SOLVER_FILES = ["src/core/prompt.ts", "src/core/solver.ts", "src/core/engine.ts", "src/core/score.ts", "src/page/image.ts"];

export const solverHash = () => sha(...SOLVER_FILES.map((f) => readFileSync(path.join(ROOT, f))));
const readJson = <T>(file: string, fallback: T): T => (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : fallback);
export const loadResults = () => readJson<BenchResults>(RESULTS_FILE, { models: {} });
export const loadVerified = () => readJson<Verified>(VERIFIED_FILE, {});

/** Write BENCHMARK.md, the SVG and the site; returns the markdown. `notMeasured`: configured models without a key. */
export function publish(results: BenchResults = loadResults(), notMeasured: string[] = []): string {
  const fixtures = loadFixtures();
  const hash = solverHash();
  const rows = leaderboard(results, Object.keys(results.models), fixtures, priceOf);
  const covered = coverage(BUILTIN_ADAPTERS, loadVerified());
  const markdown = `${renderLeaderboard(rows, fixtures, hash, notMeasured.filter((name) => !rows.some((r) => r.model === name)))}\n${renderCoverage(covered)}`;
  writeFileSync(path.join(ROOT, "BENCHMARK.md"), markdown);
  writeFileSync(path.join(ROOT, "benchmarks/leaderboard.svg"), renderSvg(rows, fixtures));
  mkdirSync(path.join(ROOT, "out/site"), { recursive: true });
  writeFileSync(path.join(ROOT, "out/site/index.html"), renderSite(rows, fixtures, hash, results.unsupported ?? {}, covered));
  return markdown;
}

// `bun src/tools/benchmark/publish.ts`: render from the committed results, no model calls (Pages).
if (import.meta.main) publish();
