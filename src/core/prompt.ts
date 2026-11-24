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
Complete the task shown in the screenshot.
Clickable targets are outlined pink, their id (t1, t2, …) on a dark label at the top-left corner.
Coordinates are screenshot pixels, origin top-left.

Reply with one JSON object, every field present, null where unused:
{"reasoning": "...", "actions": [{"kind": "click", "target": "t1", "text": null, "x": null, "y": null, "toX": null, "toY": null}]}
reasoning: brief; what the task asks and what you see.
actions, run in order:
- click: target
- type: text into target
- clickPoint: x, y
- drag: from x, y to toX, toY
- wait: nothing this round (still loading or animating)`;

const KIND_GUIDE: Record<Exclude<ChallengeKind, "checkbox" | "slider" | "hold">, string> = {
  select: `Click each tile that matches the instruction and is not selected yet (any part of the object
counts, edges too); click a selected tile that does not match to unselect it. If the instruction
says to continue until none are left, clicked tiles are replaced: click only tiles this round, not
verify. Otherwise, or when no match is left, end with the verify/submit target; if nothing matches
and it offers to skip, click it.`,
  point: `clickPoint the center of each requested object, or drag when the task says to move something.
Then click the submit target (Next / Verify / Submit); a "Skip" label means nothing is selected yet.`,
  text: `Type the characters in the image exactly (keep case unless all letters look the same height;
words separated by a space) into the "input" target. Do not click anything: it is submitted after
typing.`,
};

const box = (r: Rect, region: Rect, scale: number) =>
  `x=${Math.round((r.x - region.x) * scale)} y=${Math.round((r.y - region.y) * scale)} w=${Math.round(r.width * scale)} h=${Math.round(r.height * scale)}`;

export function buildPrompt(view: ChallengeView, image: ImageFrame, history: HistoryEntry[], motion?: MotionHint): string {
  const kind = view.kind === "checkbox" || view.kind === "slider" || view.kind === "hold" ? "select" : view.kind;
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
    `Instruction: ${view.instruction || "(none in the page text; read it from the screenshot)"}`,
    view.errors.length ? `Errors shown now: ${view.errors.join(" | ")}` : "",
    motion
      ? `Screenshots: ${motion.frames} frames ${motion.intervalMs} ms apart, oldest first, each ${image.width}x${image.height} px; only the last (current) has labels.\nRegions that moved, outlined dashed blue:\n${motion.boxes.map((b, i) => `- m${i + 1}: x=${b.x} y=${b.y} w=${b.width} h=${b.height}`).join("\n")}`
      : `Screenshot: ${image.width}x${image.height} px.`,
    `Targets:\n${targets.join("\n")}`,
    rounds.length ? `Previous rounds (an error afterwards means that round was wrong: look again, do not repeat it):\n${rounds.join("\n")}` : "",
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
