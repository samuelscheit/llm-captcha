// Stamp counting (DogWAF's compat challenge) on real challenges of fixtures/dogwaf/compat-*/
// (counts from the server's decrypted tokens), and on synthetic ones built the way the fork
// builds them: copies of one picture, columns wobbling down, later copies painting over earlier.
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { seeded } from "../../src/core/mouse";
import type { Pixels } from "../../src/core/puzzle";
import { countStamps } from "../../src/core/stamps";
import { loadCountFixtures } from "../../src/tools/fixtures";

const SHAPE = { size: 20, wobble: 4 };
const fixtures = loadCountFixtures().map((f) => ({ ...f, counted: f.counted, got: countStamps(f.images.map((png) => PNG.sync.read(png) as Pixels), f.stamps) }));

/** A 100 × 100 challenge image: blotchy noise in 5 greys, then `copies` pastes of `stamp` at the given places. */
function paint(random: () => number, stamp: number[][], copies: { x: number; y: number }[]): Pixels {
  const grey = [0, 63, 127, 191, 255];
  const size = 100;
  const blot = Array.from({ length: 34 * 34 }, () => grey[Math.floor(random() * 5)]!);
  const values = Array.from({ length: size * size }, (_, i) => blot[Math.floor(i / size / 3) * 34 + Math.floor((i % size) / 3)]!);
  for (const { x, y } of copies) {
    const wobble = Array.from({ length: 20 }, () => Math.floor(random() * 4));
    for (let c = 0; c < 20; c++) for (let r = 0; r < 20; r++) if (y + r + wobble[c]! < size) values[(y + r + wobble[c]!) * size + x + c] = stamp[c]![r]!;
  }
  const data = new Uint8Array(size * size * 4);
  values.forEach((v, i) => data.set([v, v, v, 255], i * 4));
  return { width: size, height: size, data };
}

describe("stamp counting", () => {
  it("has real challenges of the fork, and of DogWAF itself", () => {
    expect(fixtures.filter((f) => f.counted).length).toBeGreaterThanOrEqual(8);
    expect(fixtures.filter((f) => !f.counted).length).toBeGreaterThanOrEqual(2);
  });

  // Copies painted over completely cannot be seen by anyone; a few such images are expected.
  it("counts the fork's challenges: nearly every image, most challenges whole", () => {
    const counted = fixtures.filter((f) => f.counted);
    const images = counted.flatMap((f) => f.expected.counts.map((n, i) => f.got?.[i] === n));
    expect(images.filter(Boolean).length / images.length).toBeGreaterThanOrEqual(0.95);
    expect(counted.filter((f) => JSON.stringify(f.got) === JSON.stringify(f.expected.counts)).length).toBeGreaterThanOrEqual(counted.length - 2);
    // A miss is one copy too few (hidden), never a copy made up.
    for (const f of counted) f.expected.counts.forEach((n, i) => expect(f.got![i]).toBeLessThanOrEqual(n));
  });

  it("declines DogWAF's challenges, whose copies keep only half their pixels, leaving them to the model", () => {
    for (const f of fixtures.filter((f) => !f.counted)) expect(f.got, f.name).toBeNull();
  });

  const random = seeded(7);
  const stamp = Array.from({ length: 20 }, () => Array.from({ length: 20 }, () => [0, 63, 127, 191, 255][Math.floor(random() * 5)]!));

  it("counts copies that overlap, touch the bottom edge, or are missing from some images", () => {
    const layouts = [
      [{ x: 10, y: 10 }, { x: 20, y: 18 }, { x: 60, y: 70 }],
      [],
      [{ x: 79, y: 79 }],
      [{ x: 0, y: 0 }, { x: 40, y: 40 }, { x: 50, y: 45 }, { x: 0, y: 60 }],
      [{ x: 30, y: 5 }, { x: 70, y: 30 }],
    ];
    expect(countStamps(layouts.map((copies) => paint(random, stamp, copies)), SHAPE)).toEqual(layouts.map((l) => l.length));
  });

  it("declines when the picture shows too seldom to be learned", () => {
    expect(countStamps([paint(random, stamp, [{ x: 30, y: 30 }]), ...Array.from({ length: 4 }, () => paint(random, stamp, []))], SHAPE)).toBeNull();
  });
});
