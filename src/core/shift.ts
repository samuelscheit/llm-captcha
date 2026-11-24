/**
 * Shifted grids (DogWAF): the challenge image is the reference image rolled (wrapping around) by
 * whole cells of a grid, then warped, jittered and overlaid with coloured noise. Which roll it is
 * shows by correlating the two images, not by looking: every roll is scored and the best one wins.
 * Pure over RGBA pixel arrays, so it runs in page code (canvas ImageData) and in tests alike.
 */
import type { Pixels } from "./puzzle";

export interface GridShift {
  /** Cells the picture moved right and down (0 to grid - 1): reference cell (c, r) shows at ((c + dx) % grid, (r + dy) % grid). */
  dx: number;
  dy: number;
  /** How much better the best roll correlates than the runner-up (0 to 2); low means a guess. */
  margin: number;
}

/** Below this margin the roll is a guess: better ask for another challenge. Real ones score 0.3 and more. */
export const MIN_SHIFT_MARGIN = 0.1;

/**
 * Find the roll of `reference` that `challenge` (same size) shows, by normalized cross-correlation
 * over the RGB channels. Pixels on cell borders are left out: some deployments draw grid lines.
 */
export function findGridShift(reference: Pixels, challenge: Pixels, grid: number): GridShift {
  const { width, height } = reference;
  if (challenge.width !== width || challenge.height !== height) throw new Error("The challenge image differs in size from the reference.");
  const border = (v: number, size: number) => (v * grid) % size < grid || v === size - 1;
  const pixels: number[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (!border(x, width) && !border(y, height)) pixels.push(y * width + x);
  const centered = (data: Pixels["data"], at: (i: number) => number) => {
    const out = new Float32Array(pixels.length * 3);
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let k = 0; k < pixels.length; k++) sum += data[at(pixels[k]!) * 4 + c]!;
      const mean = sum / pixels.length;
      for (let k = 0; k < pixels.length; k++) out[k * 3 + c] = data[at(pixels[k]!) * 4 + c]! - mean;
    }
    return out;
  };
  const norm = (v: Float32Array) => Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  const target = centered(challenge.data, (i) => i);
  const targetNorm = norm(target);
  const scores: { dx: number; dy: number; score: number }[] = [];
  for (let dy = 0; dy < grid; dy++) {
    for (let dx = 0; dx < grid; dx++) {
      const sx = Math.round((dx * width) / grid);
      const sy = Math.round((dy * height) / grid);
      // The challenge's pixel (x, y) came from the reference's (x - sx, y - sy), wrapped.
      const source = centered(reference.data, (i) => {
        const x = i % width;
        const y = (i - x) / width;
        return ((y - sy + height) % height) * width + ((x - sx + width) % width);
      });
      let dot = 0;
      for (let k = 0; k < target.length; k++) dot += target[k]! * source[k]!;
      scores.push({ dx, dy, score: dot / (targetNorm * norm(source)) });
    }
  }
  scores.sort((a, b) => b.score - a.score);
  const [best, runnerUp] = [scores[0]!, scores[1]];
  return { dx: best.dx, dy: best.dy, margin: runnerUp ? best.score - runnerUp.score : best.score };
}
