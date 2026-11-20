import type { Expected } from "./score";
import type { ChallengeView, Decision, HistoryEntry, Rect, RoundRecord } from "./types";

/** Radius (CSS px) around an accepted click on an image within which a replay counts as the same. */
const ACCEPTED_POINT_RADIUS = 25;
/** Mirrors engine.imageFrame without importing the engine: small regions are shown at 2x. */
const scaleOf = (region: Rect) => (Math.max(region.width, region.height) < 300 ? 2 : 1);

/**
 * The answer of a round the vendor accepted, as the expected answer of its fixture: the targets it
 * clicked, the text it typed, circles around the points it clicked. Null when it did nothing.
 */
export function acceptedExpected(record: RoundRecord): Expected | null {
  const scale = scaleOf(record.view.region);
  const clicks = record.actions.filter((a) => a.kind === "click").map((a) => a.target!);
  const text = record.actions.filter((a) => a.kind === "type").map((a) => a.text ?? "").join("");
  const points = record.actions.filter((a) => a.kind === "clickPoint").map((a) => ({ x: Math.round(a.x! / scale), y: Math.round(a.y! / scale), r: ACCEPTED_POINT_RADIUS }));
  // Asking for another puzzle is not an answer to this one.
  const answers = clicks.filter((id) => id !== "reload" && id !== "refresh");
  if (!answers.length && !text && !points.length) return null;
  return {
    ...(clicks.length || record.view.kind !== "text" ? { clicks } : {}),
    ...(text ? { text, caseSensitive: false } : {}),
    ...(points.length ? { points } : {}),
  };
}

/** A captured round: what the model saw, what it did, and what the right answer is. */
export interface Fixture {
  source: string;
  capturedAt: string;
  view: ChallengeView;
  history: HistoryEntry[];
  /** Null until labeled. */
  expected: Expected | null;
  notes: string;
  /** What happened live: the decision and the errors the widget showed after it. */
  observed?: { model: string; decision: Decision; errorsAfter: string[] };
}

/** A file of a fixture directory; binary content is base64. */
export interface FixtureFile {
  path: string;
  content: string;
  encoding: "utf-8" | "base64";
}

/** Provider of an adapter: the first segment of its id (recaptcha-images → recaptcha). */
export const providerOf = (adapter: string) => adapter.split("-")[0]!;

/** <provider>/<time>-<adapter>-r<round>: where a round lands under fixtures/captured/ or a report branch. */
export function roundDir(record: RoundRecord): string {
  const stamp = new Date(record.time).toISOString().replace(/[:.]/g, "-");
  return `${providerOf(record.adapter)}/${stamp}-${record.adapter}-r${record.round}`;
}

/**
 * A round as an unlabeled fixture: fixture.json, frame-N.png (screenshots at model resolution,
 * oldest first) and labeled.png (the current frame as the model saw it). Paths are relative to
 * the fixture directory. Used by the capture script and by failure reports alike.
 */
export function fixtureFiles(record: RoundRecord, model: string, label?: { expected: Expected; notes: string }): FixtureFile[] {
  const fixture: Fixture = {
    source: record.url,
    capturedAt: new Date(record.time).toISOString(),
    view: record.view,
    history: record.history,
    expected: label?.expected ?? null,
    notes: label?.notes ?? (record.error ? `model error: ${record.error}` : ""),
    observed: { model, decision: { reasoning: record.reasoning, actions: record.actions }, errorsAfter: record.errorsAfter ?? [] },
  };
  return [
    { path: "fixture.json", content: `${JSON.stringify(fixture, null, 2)}\n`, encoding: "utf-8" },
    ...record.frames.map((frame, i) => ({ path: `frame-${i + 1}.png`, content: frame, encoding: "base64" as const })),
    ...(record.labeled ? [{ path: "labeled.png", content: record.labeled, encoding: "base64" as const }] : []),
  ];
}
