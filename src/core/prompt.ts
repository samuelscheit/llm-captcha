import type { ChallengeKind, ChallengeView, HistoryEntry, Rect } from "./types";

/** Several frames of an animated challenge and what moved between them. */
export interface MotionHint {
  frames: number;
  intervalMs: number;
  /** Image pixels. */
  boxes: Rect[];
}

/** How a region screenshot maps to CSS pixels: image px = (css px - region origin) * scale. */
export interface ImageFrame {
  width: number;
  height: number;
  scale: number;
}

export const SYSTEM_PROMPT = `You operate a web browser for its user, together with the user's automation agent.
The page shows a human-verification challenge; you complete it the way the user would.
You get a screenshot of the challenge and a list of clickable targets. Target ids are drawn as
small dark labels on the screenshot at each target's top-left corner, with a pink outline.
Animated challenges come as several frames, oldest first; the last one is the current screen and
carries the labels. Regions that moved between frames are outlined dashed blue and tagged m1, m2…

Answer with your reasoning (short: what the task asks, what you see in each relevant part) and the
actions of this round, executed in order:
- click: click a target by id ("target").
- type: type "text" into a target ("target").
- clickPoint: click at image pixel ("x","y"), origin top-left of the screenshot.
- drag: press at ("x","y"), move to ("toX","toY"), release; image pixels.
- wait: do nothing this round (images still loading or animating).
Leave fields an action does not use null.

Previous rounds of this challenge are listed with the errors the challenge showed afterwards. An
error means that round was wrong: look again more carefully instead of repeating it.`;

const KIND_GUIDE: Record<Exclude<ChallengeKind, "checkbox" | "slider">, string> = {
  select: `Click every tile that matches the instruction and is not selected yet; click a selected tile
that does not match to unselect it. A tile matches when any part of the object is in it, including
small edges. When the instruction says to continue until none are left, clicked tiles are replaced
by new images: then click only tiles this round and do not click the verify button; the next round
shows the new tiles. Otherwise, or when no matching tile is left, end with a click on the
verify/submit target. If nothing matches and the button offers to skip, click it.`,
  point: `Find the requested object(s) in the screenshot and use clickPoint on their centers, or drag
when the task asks to move something. Coordinates are image pixels of the screenshot. End with a
click on the submit target (Next / Verify / Submit) once the task on screen is done; a "Skip"
label means nothing is selected yet.`,
  text: `Read the characters in the image exactly (letters and digits; keep case unless all letters
look the same height) and type them into the "input" target. Do not click anything else.`,
};

const box = (r: Rect, region: Rect, scale: number) =>
  `x=${Math.round((r.x - region.x) * scale)} y=${Math.round((r.y - region.y) * scale)} w=${Math.round(r.width * scale)} h=${Math.round(r.height * scale)}`;

export function buildPrompt(view: ChallengeView, image: ImageFrame, history: HistoryEntry[], motion?: MotionHint): string {
  const kind = view.kind === "checkbox" || view.kind === "slider" ? "select" : view.kind;
  const targets = view.targets.map((t) => {
    const parts = [`- ${t.id}: ${box(t.rect, view.region, image.scale)}`];
    if (t.label) parts.push(`label "${t.label}"`);
    if (t.selected !== undefined) parts.push(t.selected ? "SELECTED" : "not selected");
    if (t.value !== undefined) parts.push(`value "${t.value}"`);
    return parts.join(", ");
  });
  const rounds = history.map((h, i) =>
    [
      `Round ${i + 1}: instruction "${h.instruction}"`,
      `  reasoning: ${h.decision.reasoning}`,
      `  actions: ${h.decision.actions.map(formatAction).join("; ") || "none"}`,
      `  errors afterwards: ${h.errorsAfter.length ? h.errorsAfter.join(" | ") : "none shown"}`,
    ].join("\n"),
  );
  return [
    `Challenge type: ${kind} (${view.adapter})`,
    `Instruction: ${view.instruction || "(none in the page text; read it from the screenshot)"}`,
    view.errors.length ? `Errors shown now: ${view.errors.join(" | ")}` : "",
    motion
      ? `Screenshots: ${motion.frames} frames ${motion.intervalMs} ms apart, each ${image.width}x${image.height} px; the last is current.\nMoving regions (image pixels):\n${motion.boxes.map((b, i) => `- m${i + 1}: x=${b.x} y=${b.y} w=${b.width} h=${b.height}`).join("\n")}`
      : `Screenshot: ${image.width}x${image.height} px.`,
    `Targets (image pixels):\n${targets.join("\n")}`,
    rounds.length ? `Previous rounds:\n${rounds.join("\n")}` : "",
    KIND_GUIDE[kind],
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function formatAction(a: { kind: string; target: string | null; text: string | null; x: number | null; y: number | null; toX: number | null; toY: number | null }): string {
  switch (a.kind) {
    case "click":
      return `click ${a.target}`;
    case "type":
      return `type "${a.text}" into ${a.target}`;
    case "clickPoint":
      return `clickPoint ${a.x},${a.y}`;
    case "drag":
      return `drag ${a.x},${a.y} -> ${a.toX},${a.toY}`;
    default:
      return a.kind;
  }
}
