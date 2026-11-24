/**
 * method-slider.png: a real Tencent slide puzzle solved by findPuzzleGap. The piece at its origin,
 * the contrast score at every offset (the curve the solver maximizes, with its margin over the
 * best rival a piece-edge away), and the piece moved into the gap it found.
 */
import { findPuzzleGap } from "../../core/puzzle";
import { COLOR, escapeHtml, fileUrl, fixturePath, readJson, readPng, type Renderer } from "./render";

const FIXTURE = "tencent/tencent-slider-2026-11-20T21-40-48-203Z";
/** findPuzzleGap's RIVAL_DISTANCE_PX: candidates this close to the best one are the same gap. */
const RIVAL_DISTANCE_PX = 12;

interface SliderFixture {
  origin: { x: number; y: number };
  expected: { offset: number };
}

/** The score curve as an SVG chart: the winning offset, the rival and the margin between them. */
function chart(scores: [number, number][], offset: number, margin: number, width: number, height: number): string {
  const pad = { left: 44, right: 16, top: 26, bottom: 30 };
  const xs = scores.map(([x]) => x);
  const ys = scores.map(([, y]) => y);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const top = Math.max(...ys);
  const [y0, y1] = [Math.min(0, Math.min(...ys)), Math.ceil(top * 10 + 1) / 10];
  const X = (x: number) => pad.left + ((x - x0) / (x1 - x0)) * (width - pad.left - pad.right);
  const Y = (y: number) => pad.top + (1 - (y - y0) / (y1 - y0)) * (height - pad.top - pad.bottom);
  const rival = top - margin;
  const line = scores.map(([x, y], i) => `${i ? "L" : "M"}${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join("");
  const ticksY = [];
  for (let y = Math.ceil(y0 * 10) / 10; y <= y1 + 1e-9; y += 0.1) ticksY.push(Math.round(y * 10) / 10);
  const ticksX = [];
  // The last ticks give way to the axis title.
  for (let x = Math.ceil(x0 / 50) * 50; X(x) < width - pad.right - 90; x += 50) ticksX.push(x);
  const band = [X(offset - RIVAL_DISTANCE_PX), X(offset + RIVAL_DISTANCE_PX)];
  const labelLeft = X(offset) > width * 0.7;
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="system-ui,sans-serif" font-size="11">
<style>text{paint-order:stroke;stroke:#fff;stroke-width:4px;stroke-linejoin:round}</style>
${ticksY.map((y) => `<line x1="${pad.left}" x2="${width - pad.right}" y1="${Y(y)}" y2="${Y(y)}" stroke="${COLOR.line}"/><text x="${pad.left - 8}" y="${Y(y) + 4}" text-anchor="end" fill="${COLOR.muted}">${y.toFixed(1)}</text>`).join("")}
${ticksX.map((x) => `<text x="${X(x)}" y="${height - 10}" text-anchor="middle" fill="${COLOR.muted}">${x}</text>`).join("")}
<text x="${width - pad.right}" y="${height - 10}" text-anchor="end" fill="${COLOR.muted}" font-weight="600">offset (px) →</text>
<text x="${pad.left}" y="12" fill="${COLOR.muted}" font-weight="600">contrast: ring outside the outline vs. inside it</text>
<rect x="${band[0]}" y="${pad.top}" width="${band[1]! - band[0]!}" height="${height - pad.top - pad.bottom}" fill="${COLOR.accentBg}"/>
<line x1="${pad.left}" x2="${width - pad.right}" y1="${Y(rival)}" y2="${Y(rival)}" stroke="${COLOR.muted}" stroke-dasharray="4 4"/>
<text x="${pad.left + 6}" y="${Y(rival) - 5}" fill="${COLOR.muted}">best rival ≥ ${RIVAL_DISTANCE_PX} px away: ${rival.toFixed(2)}</text>
<path d="${line}" fill="none" stroke="${COLOR.text}" stroke-width="1.4" stroke-linejoin="round"/>
<line x1="${X(offset)}" x2="${X(offset)}" y1="${Y(top)}" y2="${Y(rival)}" stroke="${COLOR.good}" stroke-width="2.5"/>
<circle cx="${X(offset)}" cy="${Y(top)}" r="5" fill="${COLOR.accent}" stroke="#fff" stroke-width="2"/>
<text x="${X(offset) + (labelLeft ? -12 : 12)}" y="${Y(top) + 4}" text-anchor="${labelLeft ? "end" : "start"}" fill="${COLOR.accent}" font-weight="700" font-size="12">gap at offset ${offset}</text>
<text x="${X(offset) + (labelLeft ? -10 : 10)}" y="${(Y(top) + Y(rival)) / 2 + 8}" text-anchor="${labelLeft ? "end" : "start"}" fill="${COLOR.good}" font-weight="700" font-size="12">margin ${margin.toFixed(2)}</text>
</svg>`;
}

/** The figure's puzzle: the fixture, its images and the gap findPuzzleGap finds. */
export function sliderSolve() {
  const dir = fixturePath(FIXTURE);
  const fixture = readJson<SliderFixture>(`${dir}/fixture.json`);
  const background = readPng(`${dir}/background.png`);
  const piece = readPng(`${dir}/piece.png`);
  return { dir, fixture, background, piece, origin: fixture.origin, ...findPuzzleGap(background, piece, fixture.origin) };
}

export async function sliderFigure(renderer: Renderer): Promise<string> {
  const { dir, fixture, background, piece, origin, offset, margin, scores } = sliderSolve();
  const k = 440 / background.width;
  const scene = (x: number, caption: string, step: number, title: string) => `<div>
<p class="step"><b>${step}</b>${title}</p>
<div class="scene" style="width:${background.width * k}px;height:${background.height * k}px">
<img class="shot" src="${fileUrl(`${dir}/background.png`)}" style="width:100%;height:100%">
<img src="${fileUrl(`${dir}/piece.png`)}" style="position:absolute;left:${x * k}px;top:${origin.y * k}px;width:${piece.width * k}px;filter:drop-shadow(0 2px 6px rgba(0,0,0,.45))">
</div><p class="cap">${caption}</p></div>`;
  const right = offset === fixture.expected.offset;
  const body = `<h1>Slide puzzles: found by image analysis, not by a model</h1>
<p class="lede">The drag must land within a few pixels, so the solver measures instead of guessing: at every offset it compares the background just inside the piece's outline with the ring just outside it. The gap is where that contrast peaks clearly above every other place.</p>
<div class="row">
${scene(origin.x, `Tencent TCaptcha, as served: background ${background.width}×${background.height}, piece at x = ${origin.x}.`, 1, "The piece at its origin")}
${scene(origin.x + offset, `Moved right by <b>${offset} px</b>. ${right ? `<span class="good">The vendor accepted ${fixture.expected.offset}.</span>` : `<span class="bad">Label: ${fixture.expected.offset}.</span>`}`, 2, "The answer: the piece in the gap")}
</div>
<p class="step" style="margin-top:20px"><b>3</b>Why there: the score at every offset · findPuzzleGap()</p>
<div class="chart">${chart(scores, offset, margin, 900, 210)}</div>
<p class="cap">${scores.length} offsets scored. The shaded band is the same gap; a margin below 0.05 would mean a guess, and the solver asks for a new puzzle instead.</p>
<p class="foot">Fixture <span class="mono">${escapeHtml(FIXTURE)}</span> · src/core/puzzle.ts</p>`;
  return renderer.figure("method-slider.png", body, {
    width: 960,
    css: `.row{display:flex;gap:20px;justify-content:space-between}.scene{position:relative}.chart{border:1px solid ${COLOR.line};border-radius:8px;padding:10px 0 4px}`,
  });
}
