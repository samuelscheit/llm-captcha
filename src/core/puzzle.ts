/**
 * Slide puzzles (Tencent TCaptcha and the like): find where the piece fits by image analysis, not
 * a model, because the drag must land within a few pixels. Pure over RGBA pixel arrays, so it runs
 * in page code (canvas ImageData) and in tests alike.
 */

export interface Pixels {
  width: number;
  height: number;
  /** RGBA, row-major. */
  data: Uint8ClampedArray | Uint8Array;
}

export interface PuzzleGap {
  /** How far right the piece must move, in background pixels, to sit in its gap. */
  offset: number;
  /** How much better the gap scores than the best place at least a piece-edge away (0 to 1); low means a guess. */
  margin: number;
}

/** Pixels of piece outline: the interior is judged this far inside the edge, the surround this far outside. */
const EDGE_PX = 3;
const RING_PX = 4;
const ALPHA_SOLID = 128;
/** Keeps a black surround from blowing the contrast up. */
const LUMINANCE_FLOOR = 8;
/** Candidates this close to the best one are the same gap, not a rival. */
const RIVAL_DISTANCE_PX = 12;
/** Below this margin the answer is a guess: better ask for another puzzle. */
export const MIN_MARGIN = 0.05;

function grey({ width, height, data }: Pixels): Float32Array {
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = 0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!;
  return out;
}

/** Offsets (into the background, from the piece's corner) of the piece's solid interior and of the ring just outside its outline. */
function pieceRegions(piece: Pixels, backgroundWidth: number) {
  const { width, height, data } = piece;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && data[(y * width + x) * 4 + 3]! >= ALPHA_SOLID;
  const within = (x: number, y: number, radius: number, test: (x: number, y: number) => boolean) => {
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) if (dx * dx + dy * dy <= radius * radius && test(x + dx, y + dy)) return true;
    return false;
  };
  const inside: number[] = [];
  const ring: number[] = [];
  let solidRight = 0;
  for (let y = -RING_PX; y < height + RING_PX; y++) {
    for (let x = -RING_PX; x < width + RING_PX; x++) {
      if (solid(x, y)) {
        solidRight = Math.max(solidRight, x);
        if (!within(x, y, EDGE_PX, (px, py) => !solid(px, py))) inside.push(y * backgroundWidth + x);
      } else if (within(x, y, RING_PX, solid)) ring.push(y * backgroundWidth + x);
    }
  }
  if (!inside.length) throw new Error("The puzzle piece has no solid pixels.");
  return { inside: Int32Array.from(inside), ring: Int32Array.from(ring), solidRight };
}

/**
 * Find the gap a piece fits into. The gap is the piece's outline cut into the background and
 * darkened, so at the right offset the pixels inside the outline are clearly darker than the ring
 * just outside it. Every offset right of the piece is scored by that contrast. The piece sits on
 * the background at `origin` (background pixels); the gap lies on the same rows.
 */
export function findPuzzleGap(background: Pixels, piece: Pixels, origin: { x: number; y: number }): PuzzleGap {
  const bg = grey(background);
  const { inside, ring, solidRight } = pieceRegions(piece, background.width);
  const rowBase = origin.y * background.width;
  let min = Infinity;
  let max = -Infinity;
  for (const i of inside) [min, max] = [Math.min(min, i), Math.max(max, i)];
  for (const i of ring) [min, max] = [Math.min(min, i), Math.max(max, i)];
  if (rowBase + min < 0 || rowBase + max >= bg.length) throw new Error("The puzzle piece does not fit the background rows.");
  const scores: [number, number][] = [];
  for (let x = origin.x + 1; x + solidRight < background.width; x++) {
    let innerSum = 0;
    let ringSum = 0;
    for (const i of inside) innerSum += bg[rowBase + x + i]!;
    for (const i of ring) ringSum += bg[rowBase + x + i]!;
    const innerMean = innerSum / inside.length;
    const ringMean = ringSum / ring.length;
    scores.push([x, (ringMean - innerMean) / (ringMean + LUMINANCE_FLOOR)]);
  }
  if (!scores.length) throw new Error("The puzzle background has no room right of the piece.");
  const best = scores.reduce((a, b) => (b[1] > a[1] ? b : a));
  let rival = 0;
  for (const [x, score] of scores) if (Math.abs(x - best[0]) > RIVAL_DISTANCE_PX && score > rival) rival = score;
  return { offset: best[0] - origin.x, margin: Math.max(0, best[1] - rival) };
}
