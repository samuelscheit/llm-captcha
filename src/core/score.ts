import type { ImageFrame } from "./prompt";
import type { Decision } from "./types";

/**
 * The right answer for a fixture, written by a person who looked at the screenshot.
 * Every given field must hold; omitted fields are not checked.
 */
export interface Expected {
  /** Exactly these targets are clicked (any order, each once). */
  clicks?: string[];
  /** Typed text; compared case-insensitively unless `caseSensitive`. */
  text?: string;
  caseSensitive?: boolean;
  /** Each circle (CSS px relative to the region) gets exactly one clickPoint, and no click misses all. */
  points?: { x: number; y: number; r: number }[];
}

export interface Score {
  pass: boolean;
  problems: string[];
}

export function score(decision: Decision, expected: Expected, frame: ImageFrame): Score {
  const problems: string[] = [];
  if (expected.clicks) {
    const clicked = decision.actions.filter((a) => a.kind === "click").map((a) => a.target!);
    const want = [...expected.clicks].sort();
    const got = [...clicked].sort();
    if (JSON.stringify(want) !== JSON.stringify(got)) {
      const missing = want.filter((id) => !got.includes(id));
      const extra = got.filter((id, i) => !want.includes(id) || got.indexOf(id) !== i);
      problems.push(`clicks: missing [${missing.join(", ")}], extra [${extra.join(", ")}]`);
    }
  }
  if (expected.text !== undefined) {
    const typed = decision.actions.filter((a) => a.kind === "type").map((a) => a.text ?? "").join("");
    const norm = (s: string) => (expected.caseSensitive ? s.trim() : s.trim().toLowerCase());
    if (norm(typed) !== norm(expected.text)) problems.push(`text: typed "${typed}", expected "${expected.text}"`);
  }
  if (expected.points) {
    const clicks = decision.actions
      .filter((a) => a.kind === "clickPoint")
      .map((a) => ({ x: a.x! / frame.scale, y: a.y! / frame.scale }));
    const hits = expected.points.map((p) => clicks.filter((c) => Math.hypot(c.x - p.x, c.y - p.y) <= p.r).length);
    hits.forEach((n, i) => n !== 1 && problems.push(`point ${i + 1}: ${n} clicks inside, expected 1`));
    const misses = clicks.filter((c) => !expected.points!.some((p) => Math.hypot(c.x - p.x, c.y - p.y) <= p.r));
    if (misses.length) problems.push(`clicks outside every expected point: ${misses.map((c) => `${Math.round(c.x)},${Math.round(c.y)}`).join(" ")}`);
  }
  return { pass: problems.length === 0, problems };
}
