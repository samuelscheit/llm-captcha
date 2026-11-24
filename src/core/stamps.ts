/**
 * Stamp counting (DogWAF's "compat" challenge): each image is noise with copies of one small
 * picture pasted over it, and the answer is how many copies, including ones partly painted over by
 * later copies. A copy is the picture quantized to a few greys, each of its columns moved down by
 * up to `wobble - 1` pixels. Neither the picture nor the noise is known up front:
 *
 * 1. Learn the picture. Its columns recur exactly wherever a copy shows them, noise columns almost
 *    never do; and column j + 1 of the picture recurs right of column j, a few pixels up or down.
 *    The longest well-supported chain of recurring columns is the picture.
 * 2. Count by peeling. The copy pasted last is fully visible. Every placement that fits the picture
 *    exactly (wobble per column) wherever it is not covered yet is a copy; once found, its pixels
 *    become wildcards, which uncovers the copies under it for the next pass.
 *
 * Pure over RGBA pixel arrays (grey images: the red channel is read), so it runs in page code and
 * in tests alike.
 */
import type { Pixels } from "./puzzle";

export interface StampShape {
  /** Width and height of a copy, in image pixels. */
  size: number;
  /** Columns move down by 0 to wobble - 1 pixels. */
  wobble: number;
}

/** Fewer visible pixels than this fit a placement by chance in the noise. */
const MIN_VISIBLE = 30;
/** A link between two picture columns must be seen this often; once is chance. */
const MIN_LINK = 2;

export interface Grey {
  width: number;
  height: number;
  data: Uint8Array;
}

export const grey = (p: Pixels): Grey => {
  const data = new Uint8Array(p.width * p.height);
  for (let i = 0; i < data.length; i++) data[i] = p.data[i * 4]!;
  return { width: p.width, height: p.height, data };
};

/** The `size` pixels of column x from row y down, as a map key. */
const columnKey = (g: Grey, x: number, y: number, size: number) => {
  let key = "";
  for (let r = 0; r < size; r++) key += String.fromCharCode(g.data[(y + r) * g.width + x]!);
  return key;
};

/** The picture's columns, left to right, or null when the images do not show it often enough. */
export function learnStamp(images: Grey[], { size, wobble }: StampShape): Uint8Array[] | null {
  const seen = new Map<string, [number, number, number][]>();
  images.forEach((g, i) => {
    for (let x = 0; x < g.width; x++) {
      for (let y = 0; y + size <= g.height; y++) {
        const key = columnKey(g, x, y, size);
        const list = seen.get(key);
        if (list) list.push([i, x, y]);
        else seen.set(key, [[i, x, y]]);
      }
    }
  });
  // Recurring columns, by image and x.
  const at = new Map<string, [number, string][]>();
  for (const [key, list] of seen) {
    if (list.length < 2) continue;
    for (const [i, x, y] of list) {
      const slot = `${i},${x}`;
      (at.get(slot) ?? at.set(slot, []).get(slot)!).push([y, key]);
    }
  }
  const links = new Map<string, Map<string, number>>();
  for (const [slot, list] of at) {
    const [i, x] = slot.split(",").map(Number);
    for (const [y, key] of list) {
      for (const [y2, key2] of at.get(`${i},${x! + 1}`) ?? []) {
        if (Math.abs(y2 - y) >= wobble || key2 === key) continue;
        const next = links.get(key) ?? links.set(key, new Map()).get(key)!;
        next.set(key2, (next.get(key2) ?? 0) + 1);
      }
    }
  }
  const successor = new Map<string, [string, number]>();
  for (const [key, next] of links) {
    const [best, n] = [...next].reduce((a, b) => (b[1] > a[1] ? b : a));
    if (n >= MIN_LINK) successor.set(key, [best, n]);
  }
  const followed = new Set([...successor.values()].map(([key]) => key));
  const starts = [...successor.keys()].filter((key) => !followed.has(key));
  let best: string[] | undefined;
  let bestWeight = -1;
  for (const start of starts.length ? starts : [...successor.keys()]) {
    const chain = [start];
    const weights: number[] = [];
    const inChain = new Set(chain);
    for (let next = successor.get(start); next && !inChain.has(next[0]); next = successor.get(next[0])) {
      chain.push(next[0]);
      weights.push(next[1]);
      inChain.add(next[0]);
    }
    // Chance links can extend a chain at either end: the best supported window of `size` columns.
    for (let a = 0; a + size <= chain.length; a++) {
      const weight = weights.slice(a, a + size - 1).reduce((s, w) => s + w, 0);
      if (weight > bestWeight) [best, bestWeight] = [chain.slice(a, a + size), weight];
    }
  }
  return best ? best.map((key) => Uint8Array.from(key, (c) => c.charCodeAt(0))) : null;
}

/** Where a copy lies: its left column, and the top row of each of its columns. */
export interface StampPlacement {
  x: number;
  tops: number[];
}

/** How many copies of `stamp` one image shows, painted over each other included. */
export function countStamp(image: Grey, stamp: Uint8Array[], shape: StampShape): number {
  return peelStamps(image, stamp, shape).flat().length;
}

/** The copies of `stamp` found in each peeling pass, topmost first. */
export function peelStamps(image: Grey, stamp: Uint8Array[], { size, wobble }: StampShape): StampPlacement[][] {
  const { width, height } = image;
  // Rows below the image are where clipped copies went: unknown, so wildcards.
  const rows = height + size + wobble;
  const wild = new Uint8Array(rows * width);
  wild.fill(1, height * width);
  const value = (x: number, y: number) => (y < height ? image.data[y * width + x]! : 0);
  const found: StampPlacement[] = [];
  const passes: StampPlacement[][] = [];
  for (;;) {
    // fits[(c * width + x) * height + top]: picture column c fits image column x from row `top`;
    // seen: how many of its pixels are not wildcards.
    const fits = new Uint8Array(size * width * height);
    const seen = new Uint16Array(size * width * height);
    for (let c = 0; c < size; c++) {
      for (let x = c; x <= width - size + c; x++) {
        for (let top = 0; top < height; top++) {
          let ok = 1;
          let visible = 0;
          for (let r = 0; r < size && ok; r++) {
            if (wild[(top + r) * width + x]) continue;
            visible++;
            if (value(x, top + r) !== stamp[c]![r]) ok = 0;
          }
          const i = (c * width + x) * height + top;
          fits[i] = ok;
          seen[i] = visible;
        }
      }
    }
    const candidates: { x: number; tops: number[]; visible: number }[] = [];
    for (let x = 0; x + size <= width; x++) {
      for (let y = 0; y + size <= height; y++) {
        const tops: number[] = [];
        let visible = 0;
        for (let c = 0; c < size; c++) {
          let top = -1;
          for (let w = 0; w < wobble && y + w < height; w++) {
            const i = ((c * width + x + c) * height + y + w);
            if (fits[i] && (top < 0 || seen[i]! > seen[((c * width + x + c) * height + top)]!)) top = y + w;
          }
          if (top < 0) break;
          tops.push(top);
          visible += seen[(c * width + x + c) * height + top]!;
        }
        // One placement per copy: the one whose highest column sits at y.
        if (tops.length === size && visible >= MIN_VISIBLE && Math.min(...tops) === y) candidates.push({ x, tops, visible });
      }
    }
    const fresh: typeof found = [];
    for (const candidate of candidates.sort((a, b) => b.visible - a.visible)) {
      const same = (f: { x: number; tops: number[] }) => f.x === candidate.x && f.tops.reduce((s, t, c) => s + Math.abs(t - candidate.tops[c]!), 0) <= (wobble - 1) * size;
      if (!found.some(same) && !fresh.some(same)) fresh.push(candidate);
    }
    if (!fresh.length) return passes;
    for (const { x, tops } of fresh) for (let c = 0; c < size; c++) for (let r = 0; r < size; r++) wild[(tops[c]! + r) * width + x + c] = 1;
    found.push(...fresh);
    passes.push(fresh.map(({ x, tops }) => ({ x, tops })));
  }
}

/** Copies in each image, or null when the images together do not show the picture often enough to learn it. */
export function countStamps(images: Pixels[], shape: StampShape): number[] | null {
  const greys = images.map(grey);
  const stamp = learnStamp(greys, shape);
  if (!stamp) return null;
  const counts = greys.map((g) => countStamp(g, stamp, shape));
  // The picture was learned from copies seen at least twice: found fewer times, it was noise.
  return counts.reduce((a, b) => a + b, 0) >= MIN_LINK ? counts : null;
}
