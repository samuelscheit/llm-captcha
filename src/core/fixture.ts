import type { Expected } from "./score";
import type { ChallengeView, Decision, HistoryEntry, RoundRecord } from "./types";

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
export function fixtureFiles(record: RoundRecord, model: string): FixtureFile[] {
  const fixture: Fixture = {
    source: record.url,
    capturedAt: new Date(record.time).toISOString(),
    view: record.view,
    history: record.history,
    expected: null,
    notes: record.error ? `model error: ${record.error}` : "",
    observed: { model, decision: { reasoning: record.reasoning, actions: record.actions }, errorsAfter: record.errorsAfter ?? [] },
  };
  return [
    { path: "fixture.json", content: `${JSON.stringify(fixture, null, 2)}\n`, encoding: "utf-8" },
    ...record.frames.map((frame, i) => ({ path: `frame-${i + 1}.png`, content: frame, encoding: "base64" as const })),
    ...(record.labeled ? [{ path: "labeled.png", content: record.labeled, encoding: "base64" as const }] : []),
  ];
}
