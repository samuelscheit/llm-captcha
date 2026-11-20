// Gap detection on the real Tencent TCaptcha puzzles of fixtures/tencent/ (known answers).
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { seeded } from "../../src/core/mouse";
import { findPuzzleGap, MIN_MARGIN, type Pixels } from "../../src/core/puzzle";
import { loadSliderFixtures } from "../../src/tools/fixtures";

const puzzles = loadSliderFixtures().map((f) => ({
  name: f.name,
  origin: f.origin,
  offset: f.expected.offset,
  background: PNG.sync.read(f.background) as Pixels,
  piece: PNG.sync.read(f.piece) as Pixels,
}));

describe("slide puzzle gap", () => {
  it("has the Tencent fixtures", () => expect(puzzles.length).toBeGreaterThanOrEqual(6));

  it.each(puzzles)("$name: offset $offset, clearly", ({ background, piece, origin, offset }) => {
    const gap = findPuzzleGap(background, piece, origin);
    expect(gap.offset).toBe(offset);
    expect(gap.margin).toBeGreaterThan(0.1);
  });

  // Tencent accepts a drag a few pixels off; 2 px is well inside.
  it.each(puzzles)("$name brighter and with sensor noise: within 2 px", ({ name, background, piece, origin, offset }) => {
    const random = seeded(name.length * 31 + offset);
    const worn = new Uint8Array(background.data);
    for (let i = 0; i < worn.length; i += 4) for (let c = 0; c < 3; c++) worn[i + c] = Math.max(0, Math.min(255, worn[i + c]! * 1.15 + (random() - 0.5) * 16));
    expect(Math.abs(findPuzzleGap({ ...background, data: worn }, piece, origin).offset - offset)).toBeLessThanOrEqual(2);
  });

  it("a background without a gap gives no confident answer", () => {
    const { background, piece, origin } = puzzles[0]!;
    const flat = new Uint8Array(background.data.length).fill(120);
    expect(findPuzzleGap({ ...background, data: flat }, piece, origin).margin).toBeLessThan(MIN_MARGIN);
  });

  it("refuses a piece without solid pixels or outside the background", () => {
    const { background, piece, origin } = puzzles[0]!;
    const clear = { width: 136, height: 136, data: new Uint8Array(136 * 136 * 4) };
    expect(() => findPuzzleGap(background, clear, origin)).toThrow("no solid pixels");
    expect(() => findPuzzleGap(background, piece, { x: origin.x, y: 380 })).toThrow("does not fit");
  });
});
