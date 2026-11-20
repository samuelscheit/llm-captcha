/**
 * Replay labeled fixtures and score the answers: model fixtures through the live model, slide
 * puzzles through the gap detector.
 * Usage: bun run eval [--filter provider/name] [--runs N] [--concurrency N]
 * Writes each model fixture's last answer to <fixture>/last-eval.json and labeled.png.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { PNG } from "pngjs";
import { findPuzzleGap } from "../core/puzzle";
import { formatAction } from "../core/prompt";
import { createModel } from "../core/solver";
import { liveModel } from "./model";
import { loadFixtures, loadSliderFixtures } from "./fixtures";
import { replay } from "./replay";

const { values } = parseArgs({
  options: { filter: { type: "string" }, runs: { type: "string", default: "1" }, concurrency: { type: "string", default: "4" } },
});
const fixtures = loadFixtures(values.filter);
const sliders = loadSliderFixtures(values.filter);
if (!fixtures.length && !sliders.length) throw new Error("No labeled fixtures (fixtures/<provider>/<name>/fixture.json with `expected`).");

// Slide puzzles: deterministic, no model. Tencent accepts a few pixels off; 2 is the bar here.
let slidersPassed = 0;
for (const f of sliders) {
  const gap = findPuzzleGap(PNG.sync.read(f.background), PNG.sync.read(f.piece), f.origin);
  const pass = Math.abs(gap.offset - f.expected.offset) <= 2;
  slidersPassed += pass ? 1 : 0;
  console.log(`${pass ? "PASS" : "FAIL"} ${f.name} gap ${gap.offset} (expected ${f.expected.offset}), margin ${gap.margin.toFixed(2)}`);
}
if (sliders.length) console.log(`slide puzzles: ${slidersPassed}/${sliders.length} passed\n`);
if (!fixtures.length) {
  process.exitCode = slidersPassed === sliders.length ? 0 : 1;
  process.exit();
}
const config = liveModel();
const runs = Number(values.runs);
const jobs = fixtures.flatMap((fixture) => Array.from({ length: runs }, (_, run) => ({ fixture, model: config, run })));

const results = await replay(jobs, createModel, {
  concurrency: Number(values.concurrency),
  onResult(r) {
    const label = `${r.fixture.name}${runs > 1 ? ` #${r.run + 1}` : ""} (${(r.ms / 1000).toFixed(1)}s)`;
    console.log(`${r.pass ? "PASS" : "FAIL"} ${label} ${r.decision?.actions.map(formatAction).join("; ") ?? ""}`);
    for (const p of r.problems) console.log(`     ${p}`);
    if (r.decision) {
      writeFileSync(path.join(r.fixture.dir, "last-eval.json"), `${JSON.stringify({ model: config.model, run: r.run, pass: r.pass, problems: r.problems, decision: r.decision }, null, 2)}\n`);
      writeFileSync(path.join(r.fixture.dir, "labeled.png"), Buffer.from(r.image!, "base64"));
    }
  },
});
const passed = results.filter((r) => r.pass).length;
console.log(`\n${config.model}: ${passed}/${results.length} passed`);
process.exitCode = passed === results.length && slidersPassed === sliders.length ? 0 : 1;
