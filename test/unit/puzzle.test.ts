// Gap detection on the real slide puzzles of fixtures/<provider>/ (offsets the vendors accepted,
// or known answers for the hand-made Tencent ones). Captured ones act as regression tests: their
// offset was measured by this gap finder and passed by the vendor.
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { seeded } from "../../src/core/mouse";
import { findPuzzleGap, MIN_MARGIN, type Pixels } from "../../src/core/puzzle";
import { loadSliderFixtures } from "../../src/tools/fixtures";
import { backgroundUrl } from "../../src/page/puzzle";

const puzzles = loadSliderFixtures().map((f) => ({
  name: f.name,
  origin: f.origin,
  offset: f.expected.offset,
  background: PNG.sync.read(f.background) as Pixels,
  piece: PNG.sync.read(f.piece) as Pixels,
}));

describe("slide puzzle gap", () => {
  it("has the Tencent fixtures", () => expect(puzzles.length).toBeGreaterThanOrEqual(6));

  // Some vendors draw decoy gaps (GeeTest v4, Dingxiang): sure enough to slide is the bar.
  it.each(puzzles)("$name: offset $offset, sure enough to slide", ({ background, piece, origin, offset }) => {
    const gap = findPuzzleGap(background, piece, origin);
    expect(gap.offset).toBe(offset);
    expect(gap.margin).toBeGreaterThan(MIN_MARGIN);
  });

  // Tencent accepts a drag a few pixels off; 2 px is well inside.
  it.each(puzzles)("$name brighter and with sensor noise: within 2 px", ({ name, background, piece, origin, offset }) => {
    const random = seeded(name.length * 31 + offset);
    const worn = new Uint8Array(background.data);
    for (let i = 0; i < worn.length; i += 4) for (let c = 0; c < 3; c++) worn[i + c] = Math.max(0, Math.min(255, worn[i + c]! * 1.15 + (random() - 0.5) * 16));
    expect(Math.abs(findPuzzleGap({ ...background, data: worn }, piece, origin).offset - offset)).toBeLessThanOrEqual(2);
  });

  // Aliyun draws its gap lighter than the surround, Tencent darker: both must be found. Checked
  // on Tencent's clean gaps; with decoys and bevels (Dingxiang, Yidun) inverting favors the decoys.
  it.each(puzzles.filter((p) => p.name.startsWith("tencent/slider-")))("$name with a light gap instead of a dark one (inverted image)", ({ background, piece, origin, offset }) => {
    const inverted = new Uint8Array(background.data);
    for (let i = 0; i < inverted.length; i += 4) for (let c = 0; c < 3; c++) inverted[i + c] = 255 - inverted[i + c]!;
    const gap = findPuzzleGap({ ...background, data: inverted }, piece, origin);
    expect(gap.offset).toBe(offset);
    expect(gap.margin).toBeGreaterThan(0.05);
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

describe("puzzle images from CSS backgrounds", () => {
  it.each([
    ['url("https://static.geetest.com/pictures/bg.jpg")', "https://static.geetest.com/pictures/bg.jpg"],
    ["url('data:image/png;base64,AAAA')", "data:image/png;base64,AAAA"],
    ["url(/img/piece.png), linear-gradient(red, blue)", "/img/piece.png"],
    ["none", undefined],
    ["linear-gradient(red, blue)", undefined],
  ])("%s → %s", (css, url) => expect(backgroundUrl(css)).toBe(url));
});
