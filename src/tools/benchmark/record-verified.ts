/**
 * Merge vitest JSON reports of runs against real widgets into benchmarks/verified.json, then
 * re-render the leaderboard. Tests name the adapters they verify as `[adapter-id]` in their titles.
 *
 *   bun src/tools/benchmark/record-verified.ts out/reports/live.json [more reports]
 *
 * `bun run live` and `bun run e2e` call it; failures are recorded too.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mergeReport, type VitestReport } from "./coverage";
import { loadVerified, publish, VERIFIED_FILE } from "./publish";

let verified = loadVerified();
for (const report of process.argv.slice(2)) {
  if (!existsSync(report)) continue;
  verified = mergeReport(verified, JSON.parse(readFileSync(report, "utf8")) as VitestReport);
}
writeFileSync(VERIFIED_FILE, `${JSON.stringify(Object.fromEntries(Object.entries(verified).sort()), null, 2)}\n`);
publish();
console.log(`recorded ${Object.keys(verified).length} verified adapters; BENCHMARK.md and the site re-rendered`);
