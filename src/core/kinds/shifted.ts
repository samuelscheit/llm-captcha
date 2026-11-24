/**
 * Shifted grids (DogWAF): the task names something in a picture ("the square with the dog's
 * nose"), but the picture to click is a rolled, noised copy of a clean reference image. Finding the
 * thing is the model's part, on the clean reference; the roll is measured by image analysis
 * (`findGridShift`), and the engine clicks the cell the model's point lands in, rolled.
 */
import type { ImageFrame } from "../prompt";
import type { GridShift } from "../shift";
import { intersects } from "../geometry";
import type { Action, ChallengeView } from "../types";

/** The view the model answers: the reference image alone, and how its answer is used. */
export function shiftedView(view: ChallengeView): ChallengeView {
  return {
    ...view,
    instruction: `${view.instruction} [The screenshot is the clean reference image; the challenge image is the same picture shifted and noised. Click the spot in the reference image with clickPoint; the matching square of the challenge image is clicked for you.]`,
    targets: view.targets.filter((t) => intersects(t.rect, view.region)),
  };
}

/**
 * The model's first point on the reference, as a click on the centre of the matching challenge
 * cell; a click answers the challenge, so further points are dropped. Coordinates stay in the
 * screenshot's image pixels (relative to the reference), as `execute` expects them.
 */
export function toChallengeCell(actions: Action[], view: ChallengeView, frame: ImageFrame, shift: Pick<GridShift, "dx" | "dy">, grid: number): Action[] {
  const point = actions.find((a) => a.kind === "clickPoint");
  const challenge = view.targets.find((t) => t.id === "challenge")?.rect;
  if (!point || !challenge) return actions.filter((a) => a.kind !== "clickPoint");
  const cell = (at: number, size: number) => Math.min(grid - 1, Math.max(0, Math.floor((at / frame.scale / size) * grid)));
  const column = (cell(point.x!, view.region.width) + shift.dx) % grid;
  const row = (cell(point.y!, view.region.height) + shift.dy) % grid;
  const x = (challenge.x + ((column + 0.5) * challenge.width) / grid - view.region.x) * frame.scale;
  const y = (challenge.y + ((row + 0.5) * challenge.height) / grid - view.region.y) * frame.scale;
  return [{ ...point, x, y }, ...actions.filter((a) => a.kind !== "clickPoint")];
}
