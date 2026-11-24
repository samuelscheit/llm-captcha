/**
 * method-shift.png: DogWAF's shifted grid solved by findGridShift. The reference, the challenge
 * (the reference rolled by whole cells under noise), the correlation of every roll, and the
 * challenge rolled back by the winner, which lines up with the reference.
 */
import { findGridShift } from "../../core/shift";
import type { Pixels } from "../../core/puzzle";
import { COLOR, dataUrl, encodePng, escapeHtml, fileUrl, fixturePath, readJson, readPng, type Renderer } from "./render";

const FIXTURE = "dogwaf/shift-live-1";
const SIZE = 232;

interface ShiftFixture {
  grid: number;
  expected: { dx: number; dy: number };
}

/** The challenge rolled back by (dx, dy) cells: what the reference should look like under the noise. */
function unroll(challenge: Pixels, dx: number, dy: number, grid: number): Pixels {
  const { width, height } = challenge;
  const sx = Math.round((dx * width) / grid);
  const sy = Math.round((dy * height) / grid);
  const data = new Uint8ClampedArray(challenge.data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (((y + sy) % height) * width + ((x + sx) % width)) * 4;
      data.set(challenge.data.subarray(from, from + 4), (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

/** White to accent blue, by score within [min, max]. */
function heat(score: number, min: number, max: number): string {
  const t = Math.max(0, Math.min(1, (score - min) / (max - min))) ** 1.4;
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  return `rgb(${mix(246, 0x2f)},${mix(246, 0x5b)},${mix(244, 0xea)})`;
}

/** The roll scores as a grid of cells, the best one outlined; `axis` numbers the rows and columns. */
export function heatmap(scores: number[], grid: number, best: { dx: number; dy: number }, size: number, axis = true): string {
  const cell = size / grid;
  const [min, max] = [Math.min(...scores), Math.max(...scores)];
  const cells = scores
    .map((s, i) => {
      const [dx, dy] = [i % grid, Math.floor(i / grid)];
      return `<rect x="${dx * cell}" y="${dy * cell}" width="${cell}" height="${cell}" fill="${heat(s, min, max)}"><title>(${dx}, ${dy}): ${s.toFixed(3)}</title></rect>`;
    })
    .join("");
  const labels = axis ? Array.from({ length: grid }, (_, i) => `<text x="${i * cell + cell / 2}" y="-6" text-anchor="middle">${i}</text><text x="-6" y="${i * cell + cell / 2 + 4}" text-anchor="end">${i}</text>`).join("") : "";
  const [pad, top] = axis ? [22, 18] : [0, 0];
  return `<svg width="${size + pad + 2}" height="${size + top + 2}" viewBox="${-pad} ${-top} ${size + pad + 2} ${size + top + 2}" font-family="system-ui,sans-serif" font-size="9.5" fill="${COLOR.muted}">
${cells}${labels}
<rect x="${best.dx * cell}" y="${best.dy * cell}" width="${cell}" height="${cell}" fill="none" stroke="${COLOR.bad}" stroke-width="2.5"/>
</svg>`;
}

/** The figure's round: the fixture, its images and the roll findGridShift measures. */
export function shiftSolve() {
  const dir = fixturePath(FIXTURE);
  const fixture = readJson<ShiftFixture>(`${dir}/fixture.json`);
  const reference = readPng(`${dir}/reference.png`);
  const challenge = readPng(`${dir}/challenge.png`);
  return { dir, fixture, reference, challenge, ...findGridShift(reference, challenge, fixture.grid) };
}

export async function shiftFigure(renderer: Renderer): Promise<string> {
  const { dir, fixture, reference, challenge, dx, dy, margin, scores } = shiftSolve();
  const ranked = [...scores].sort((a, b) => b - a);
  const right = dx === fixture.expected.dx && dy === fixture.expected.dy;
  const panel = (step: number, title: string, content: string, caption: string) => `<div class="panel"><p class="step"><b>${step}</b>${title}</p>${content}<p class="cap">${caption}</p></div>`;
  const image = (src: string, overlay = "") => `<div class="stack"><img class="shot px" src="${src}" width="${SIZE}" height="${SIZE}">${overlay}</div>`;
  // Where the rolled picture wraps around: the reference's top-left corner now sits at cell (dx, dy).
  const [seamX, seamY] = [(dx * SIZE) / fixture.grid, (dy * SIZE) / fixture.grid];
  const seams = `<svg class="overlay" width="${SIZE}" height="${SIZE}"><path d="M${seamX},0V${SIZE}M0,${seamY}H${SIZE}" stroke="#fff" stroke-width="5" opacity=".85"/><path d="M${seamX},0V${SIZE}M0,${seamY}H${SIZE}" stroke="${COLOR.bad}" stroke-width="2.5" stroke-dasharray="7 5"/></svg>`;
  const body = `<h1>Shifted grids: found by correlation, not by looking</h1>
<p class="lede">DogWAF shows a picture and the same picture rolled by whole cells of a ${fixture.grid}×${fixture.grid} grid, warped and buried in coloured noise. The solver scores all ${scores.length} rolls by normalized cross-correlation; the right one stands out even where the eye sees nothing.</p>
<div class="row">
${panel(1, "Reference", image(fileUrl(`${dir}/reference.png`)), `${reference.width}×${reference.height} px, as served.`)}
${panel(2, "Challenge", image(fileUrl(`${dir}/challenge.png`), seams), "Rolled, warped and noised. Dashed: where the found roll wraps the picture around.")}
${panel(3, "Every roll scored", heatmap(scores, fixture.grid, { dx, dy }, SIZE), `Columns dx, rows dy. Best <b>(${dx}, ${dy})</b>: ${ranked[0]!.toFixed(2)} vs. ${ranked[1]!.toFixed(2)} next, margin ${margin.toFixed(2)}.`)}
${panel(4, `Rolled back by (${dx}, ${dy})`, image(dataUrl(encodePng(unroll(challenge, dx, dy, fixture.grid)))), right ? `<span class="good">The reference's layout under the noise; the site accepted this roll.</span>` : `<span class="bad">Label: (${fixture.expected.dx}, ${fixture.expected.dy}).</span>`)}
</div>
<p class="foot">Fixture <span class="mono">${escapeHtml(FIXTURE)}</span> · src/core/shift.ts</p>`;
  return renderer.figure("method-shift.png", body, {
    width: 1120,
    css: `.row{display:flex;gap:26px;align-items:flex-start}.panel{width:${SIZE + 24}px}.panel svg{display:block}.stack{position:relative}.overlay{position:absolute;left:1px;top:1px}`,
  });
}
