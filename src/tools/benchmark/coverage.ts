/**
 * Which challenges the solver covers, how it solves each, and when that was last verified against
 * the real widget. Verification comes from test runs: tests against real widgets name the adapters
 * they exercise as `[adapter-id]` in their titles; their vitest JSON reports are merged into
 * benchmarks/verified.json. Pure functions; record-verified.ts does the I/O.
 */
import type { AdapterSpec } from "../../core/types";

export interface Verification {
  /** Last passing test against the real widget, ISO time, and its title. */
  passedAt?: string;
  passedBy?: string;
  /** Last failing one, when it is newer than the last pass. */
  failedAt?: string;
  failedBy?: string;
}

/** adapter id → verification */
export type Verified = Record<string, Verification>;

/** The part of a vitest JSON report this reads. */
export interface VitestReport {
  startTime: number;
  testResults: { assertionResults: { fullName: string; title: string; status: "passed" | "failed" | "skipped" | "pending" | "todo" }[] }[];
}

const TAG = /\[([a-z0-9-]+)\]/g;

/** Adapter ids a test names in its title, `[recaptcha-images]`. */
export const tagsOf = (title: string) => [...title.matchAll(TAG)].map((m) => m[1]!);

/** Merge one report: a pass sets passedAt (and clears an older failure), a failure sets failedAt. */
export function mergeReport(verified: Verified, report: VitestReport): Verified {
  const at = new Date(report.startTime).toISOString();
  const next: Verified = structuredClone(verified);
  for (const file of report.testResults) {
    for (const test of file.assertionResults) {
      if (test.status !== "passed" && test.status !== "failed") continue;
      for (const id of tagsOf(test.fullName)) {
        const entry = (next[id] ??= {});
        if (test.status === "passed") {
          Object.assign(entry, { passedAt: at, passedBy: test.fullName });
          delete entry.failedAt;
          delete entry.failedBy;
        } else Object.assign(entry, { failedAt: at, failedBy: test.fullName });
      }
    }
  }
  return next;
}

/** How the solver gets through a challenge, from its adapter. */
export function methodOf(adapter: AdapterSpec): string {
  switch (adapter.kind) {
    case "checkbox":
      if (adapter.targets.length) return "checkbox click";
      return adapter.blocked || adapter.blockedText ? "recognized: a refusal" : "waits for its own check";
    case "hold":
      return "press and hold";
    case "slider":
      return adapter.targets.some((t) => t.id === "piece") ? "image analysis + drag" : "slide to end";
    case "select":
      return "vision model: pick tiles";
    case "point":
      return adapter.shiftedGrid ? "vision model + image analysis: click a cell" : "vision model: click points";
    case "text":
      return adapter.stamps ? "image analysis: count (vision model as fallback)" : "vision model: read text";
  }
}

export interface CoverageRow {
  provider: string;
  adapter: string;
  method: string;
  verification: Verification;
}

export function coverage(adapters: AdapterSpec[], verified: Verified): CoverageRow[] {
  return adapters.map((a) => ({ provider: a.id.split("-")[0]!, adapter: a.id, method: methodOf(a), verification: verified[a.id] ?? {} }));
}

/** "✅ 2026-11-20", "❌ 2026-11-20 (last pass 2026-11-02)", or "not yet". */
export function verificationLabel(v: Verification): string {
  if (v.failedAt) return `❌ ${v.failedAt.slice(0, 10)}${v.passedAt ? ` (last pass ${v.passedAt.slice(0, 10)})` : ""}`;
  if (v.passedAt) return `✅ ${v.passedAt.slice(0, 10)}`;
  return "not yet";
}

export function renderCoverage(rows: CoverageRow[]): string {
  return [
    "## Coverage",
    "",
    "Every challenge the solver recognizes, how it gets through it, and when that was last verified against the real widget (`bun run live`, and the vendor test widgets in `bun run e2e`). Model-solved challenges are measured per model in the table above.",
    "",
    "| Provider | Challenge | Solved by | Verified on the real widget |",
    "|---|---|---|---|",
    ...rows.map((r) => `| ${r.provider} | \`${r.adapter}\` | ${r.method} | ${verificationLabel(r.verification)} |`),
    "",
  ].join("\n");
}
