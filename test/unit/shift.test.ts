// Shifted grids (DogWAF): the roll of the challenge image against the reference, on real pairs of
// fixtures/dogwaf/shift-*/ (rolls the server issued or accepted), and the click it turns into.
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { shiftedView, toChallengeCell } from "../../src/core/kinds/shifted";
import type { Pixels } from "../../src/core/puzzle";
import { findGridShift, MIN_SHIFT_MARGIN } from "../../src/core/shift";
import type { Action, ChallengeView } from "../../src/core/types";
import { loadShiftFixtures } from "../../src/tools/fixtures";

const pairs = loadShiftFixtures().map((f) => ({ ...f, ref: PNG.sync.read(f.reference) as Pixels, ch: PNG.sync.read(f.challenge) as Pixels }));

/** `image` rolled right by dx and down by dy pixels, wrapping around. */
function roll(image: Pixels, dx: number, dy: number): Pixels {
  const { width, height } = image;
  const data = new Uint8Array(image.data.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) data.set(image.data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4), (((y + dy) % height) * width + ((x + dx) % width)) * 4);
  return { width, height, data };
}

describe("grid roll", () => {
  it("has real DogWAF pairs, from the live site and a local server", () => {
    expect(pairs.filter((p) => p.name.includes("live")).length).toBeGreaterThanOrEqual(2);
    expect(pairs.length).toBeGreaterThanOrEqual(8);
  });

  it.each(pairs)("$name: roll ($expected.dx, $expected.dy), clearly", ({ ref, ch, grid, expected }) => {
    const shift = findGridShift(ref, ch, grid);
    expect([shift.dx, shift.dy]).toEqual([expected.dx, expected.dy]);
    expect(shift.margin).toBeGreaterThan(MIN_SHIFT_MARGIN * 2);
  });

  it("finds every roll of a clean image, the unrolled one included", () => {
    const { ref } = pairs[0]!;
    for (const [dx, dy] of [[0, 0], [9, 0], [0, 9], [3, 7], [9, 9]] as const) {
      expect(findGridShift(ref, roll(ref, dx * 10, dy * 10), 10)).toMatchObject({ dx, dy });
    }
  });

  it("says it is guessing when the challenge is not the reference at all", () => {
    const { ref } = pairs[0]!;
    const flat = { ...ref, data: new Uint8Array(ref.data.length).fill(128) };
    expect(findGridShift(ref, flat, 10).margin).toBeLessThan(MIN_SHIFT_MARGIN);
  });

  it("refuses images of different sizes", () => {
    const { ref } = pairs[0]!;
    expect(() => findGridShift(ref, { width: 50, height: 50, data: new Uint8Array(50 * 50 * 4) }, 10)).toThrow("differs in size");
  });
});

describe("click on the rolled cell", () => {
  // DogWAF's layout: the 400 px reference above the 400 px challenge, both 10 × 10 squares.
  const view: ChallengeView = {
    adapter: "dogwaf-shifted",
    kind: "point",
    status: "pending",
    region: { x: 100, y: 50, width: 400, height: 400 },
    instruction: "Click on the square with Lulu's nose in the challenge image.",
    errors: [],
    targets: [
      { id: "challenge", rect: { x: 100, y: 500, width: 400, height: 400 } },
      { id: "refresh", rect: { x: 100, y: 920, width: 150, height: 18 } },
    ],
    visible: true,
  };
  const point = (x: number, y: number): Action => ({ kind: "clickPoint", target: null, text: null, x, y, toX: null, toY: null });
  const frame = { width: 400, height: 400, scale: 1 };

  it("shows the model the reference alone, and how its point is used", () => {
    const asked = shiftedView(view);
    expect(asked.targets).toEqual([]);
    expect(asked.instruction).toContain("Click the spot in the reference image");
  });

  it("moves the point to the centre of the matching challenge square, wrapping around", () => {
    // Nose at square (6, 5) of the reference; rolled by (9, 5): square (5, 0) of the challenge.
    const [click] = toChallengeCell([point(262, 221)], view, frame, { dx: 9, dy: 5, margin: 0.4 }, 10);
    // Square (5, 0) of the challenge spans x 300–340, y 500–540 in the page: its centre, relative to the reference.
    expect([click!.x, click!.y]).toEqual([320 - 100, 520 - 50]);
  });

  it("maps through the screenshot's scale, keeps points on the edge in the image, and answers once", () => {
    const actions = toChallengeCell([point(799, 0), point(10, 10)], view, { width: 800, height: 800, scale: 2 }, { dx: 0, dy: 0, margin: 0.4 }, 10);
    expect(actions).toHaveLength(1);
    // Square (9, 0): page x 460–500, y 500–540; in image pixels (scale 2) relative to the reference.
    expect([actions[0]!.x, actions[0]!.y]).toEqual([(480 - 100) * 2, (520 - 50) * 2]);
  });
});
