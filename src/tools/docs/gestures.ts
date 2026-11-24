/**
 * method-gestures.svg: pointer tracks planned by src/core/mouse.ts with its seeded random source,
 * animated on their own timings. One dot per pointer event, so the spacing shows the speed: a
 * click's eased approach, a slider drag's minimum-jerk profile with overshoot, and a press & hold
 * that keeps the hand slightly moving.
 */
import { HOLD_JITTER_PX, holdTrack } from "../../core/kinds/hold";
import { clickSteps, dragSteps, seeded, type MouseStep, type Point } from "../../core/mouse";
import { escapeHtml, type Renderer } from "./render";
import { SVG_THEME, svgDocument, Timeline } from "./svg";

/** Playback speed: real timings, slowed so a click is still visible. */
const SPEED = 0.6;
const LOOP_MS = 7600;
const START_MS = 400;
const [W, H] = [960, 400];
const PANEL = { width: 288, top: 84, height: 210 };
const HOLD_MS = 3000;

interface Panel {
  title: string;
  caption: string;
  /** Display px per CSS px. */
  scale: number;
  steps: MouseStep[];
  /** Widget shapes under the track, in CSS px; `p` maps to the panel. */
  decor: (p: (q: Point) => Point, s: number) => string;
  /** Extra points (CSS px) the panel must show besides the track. */
  bounds: Point[];
  /** Magnify the moves around this point (CSS px), for movements too small to see. */
  lens?: Point;
}

const LENS = { factor: 7, radius: 44, dx: 92, dy: -58 };


const tile = { x: 120, y: 70, width: 64, height: 64 };
const rail = { x: 0, y: 0, width: 250, height: 36 };
const button = { x: 0, y: 0, width: 150, height: 44 };

const PANELS: Panel[] = [
  {
    title: "Click",
    caption: "Eased approach: slow start, fast middle, slow landing.",
    scale: 1.8,
    steps: clickSteps({ x: tile.x + tile.width / 2, y: tile.y + tile.height / 2 }, seeded(3), { x: 30, y: 20 }),
    decor: (p, s) => `<rect class="line" x="${p(tile).x}" y="${p(tile).y}" width="${tile.width * s}" height="${tile.height * s}" rx="6" fill="none" stroke-width="1.5" stroke-dasharray="5 4"/>`,
    bounds: [
      { x: tile.x, y: tile.y },
      { x: tile.x + tile.width, y: tile.y + tile.height },
    ],
  },
  {
    title: "Drag a slider",
    caption: "Minimum-jerk drag with sideways wander, a small overshoot, settling back.",
    scale: 1.05,
    steps: (() => {
      const random = seeded(11);
      const from = { x: 20, y: 18 };
      return dragSteps(from, { x: 220, y: 18 }, random, { x: 60, y: 90 });
    })(),
    decor: (p, s) =>
      `<rect class="line" x="${p(rail).x}" y="${p(rail).y}" width="${rail.width * s}" height="${rail.height * s}" rx="${18 * s}" fill="none" stroke-width="1.5"/>
<rect class="line" x="${p({ x: 205, y: 3 }).x}" y="${p({ x: 205, y: 3 }).y}" width="${30 * s}" height="${30 * s}" rx="6" fill="none" stroke-width="1.5" stroke-dasharray="4 3"/>`,
    bounds: [
      { x: rail.x, y: rail.y - 20 },
      { x: rail.x + rail.width, y: 96 },
    ],
  },
  {
    title: "Press & hold",
    caption: `Held for ${HOLD_MS / 1000} s, the hand never quite still: ±${HOLD_JITTER_PX} px, magnified ${LENS.factor}×.`,
    scale: 1.3,
    steps: holdTrack({ x: 75, y: 22, width: 0, height: 0 }, HOLD_MS, seeded(5)),
    lens: { x: 75, y: 22 },
    decor: (p, s) => `<rect class="line" x="${p(button).x}" y="${p(button).y}" width="${button.width * s}" height="${button.height * s}" rx="${22 * s}" fill="none" stroke-width="1.5"/>`,
    bounds: [
      { x: button.x, y: button.y - 50 },
      { x: button.x + button.width, y: button.y + button.height + 10 },
      { x: 75 + (LENS.dx + LENS.radius) / 1.3, y: 22 + (LENS.dy - LENS.radius) / 1.3 },
    ],
  },
];

/** Greedy word wrap for SVG text, which does not wrap by itself. */
function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(" ")) {
    const last = lines.at(-1);
    if (last !== undefined && `${last} ${word}`.length <= max) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

function panel(tl: Timeline, spec: Panel, index: number): string {
  const x0 = 24 + index * (PANEL.width + 24);
  const s = spec.scale;
  const all = [...spec.steps, ...spec.bounds];
  const [minX, maxX] = [Math.min(...all.map((q) => q.x)), Math.max(...all.map((q) => q.x))];
  const [minY, maxY] = [Math.min(...all.map((q) => q.y)), Math.max(...all.map((q) => q.y))];
  const offset = { x: x0 + (PANEL.width - (maxX - minX) * s) / 2 - minX * s, y: PANEL.top + (PANEL.height - (maxY - minY) * s) / 2 - minY * s };
  const p = (q: Point) => ({ x: offset.x + q.x * s, y: offset.y + q.y * s });

  let clock = START_MS;
  const timed = spec.steps.map((step) => {
    const at = clock;
    clock += step.delayMs / SPEED;
    return { step, at, d: p(step) };
  });
  const mark = (step: MouseStep, d: Point) => {
    if (step.type === "mousePressed") return `<circle cx="${d.x}" cy="${d.y}" r="8" fill="none" stroke="#2f5bea" stroke-width="2"/>`;
    if (step.type === "mouseReleased") return `<circle cx="${d.x}" cy="${d.y}" r="12" fill="none" stroke="#1a7f4b" stroke-width="2"/>`;
    return `<circle cx="${d.x.toFixed(1)}" cy="${d.y.toFixed(1)}" r="${step.buttons ? 2.8 : 2.4}" ${step.buttons ? 'fill="#2f5bea"' : 'class="muted"'}/>`;
  };
  // The whole track, faint and always there, so no moment of the loop is empty; the solid marks replay it.
  const ghost = timed.map(({ step, d }) => mark(step, d)).join("");
  const dots = timed.map(({ step, at, d }) => `<g ${tl.appear(at, 60)}>${mark(step, d)}</g>`).join("");
  let lens = "";
  if (spec.lens) {
    const at = p(spec.lens);
    const c = { x: at.x + LENS.dx, y: at.y + LENS.dy };
    const held = timed.filter(({ step }) => step.buttons === 1 && step.type === "mouseMoved");
    const zoom = (step: MouseStep) => `<circle cx="${(c.x + (step.x - spec.lens!.x) * LENS.factor).toFixed(1)}" cy="${(c.y + (step.y - spec.lens!.y) * LENS.factor).toFixed(1)}" r="3" fill="#2f5bea"/>`;
    lens = `<line class="line" x1="${at.x}" y1="${at.y}" x2="${c.x - LENS.radius * 0.7}" y2="${c.y + LENS.radius * 0.7}" stroke-width="1.5"/>
<circle class="card" cx="${c.x}" cy="${c.y}" r="${LENS.radius}" stroke-width="1.5"/>
<path class="line" d="M${c.x - 6},${c.y}h12M${c.x},${c.y - 6}v12" stroke-width="1.5"/>
<g opacity=".2">${held.map(({ step }) => zoom(step)).join("")}</g>${held.map(({ step, at: ms }) => `<g ${tl.appear(ms, 60)}>${zoom(step)}</g>`).join("")}`;
  }
  const first = timed[0]!.d;
  const pointer: [number, string][] = [
    [0, `transform:translate(${first.x}px,${first.y}px);opacity:0`],
    [START_MS - 1, `transform:translate(${first.x}px,${first.y}px);opacity:0`],
    ...timed.map(({ at, d }): [number, string] => [at, `transform:translate(${d.x.toFixed(1)}px,${d.y.toFixed(1)}px);opacity:1`]),
  ];
  const end = timed.at(-1)!;
  pointer.push([end.at + 600, `transform:translate(${end.d.x.toFixed(1)}px,${end.d.y.toFixed(1)}px);opacity:0`]);
  const durationMs = (clock - START_MS) * SPEED;
  return `<text class="ink" x="${x0}" y="58" font-size="15" font-weight="650">${escapeHtml(spec.title)}</text>
<text class="muted" x="${x0 + PANEL.width}" y="58" font-size="12" text-anchor="end">${spec.steps.length} events · ${Math.round(durationMs)} ms</text>
${spec.decor(p, s)}
<g opacity=".2">${ghost}</g>
${dots}
${lens}
<g ${tl.keyframes(pointer, "opacity:0")}><path d="M0,0 L0,17 L4.6,12.8 L7.6,19.6 L10.4,18.4 L7.4,11.8 L13.2,11.6 Z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></g>
<text class="muted" x="${x0}" y="${PANEL.top + PANEL.height + 22}" font-size="12.5">${wrap(escapeHtml(spec.caption), 44)
    .map((line, i) => `<tspan x="${x0}" dy="${i ? 16 : 0}">${line}</tspan>`)
    .join("")}</text>`;
}

export function gesturesFigure(renderer: Renderer): Promise<string> {
  const tl = new Timeline(LOOP_MS);
  const panels = PANELS.map((spec, i) => panel(tl, spec, i)).join("\n");
  const legendY = H - 22;
  const body = `<rect class="card" x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12"/>
<text class="muted" x="24" y="30" font-size="12.5">Pointer tracks planned by src/core/mouse.ts (seeded), played at ${SPEED}× speed</text>
${panels}
<line class="line" x1="24" x2="${W - 24}" y1="${legendY - 22}" y2="${legendY - 22}"/>
<circle class="muted" cx="30" cy="${legendY - 4}" r="2.4"/><text class="muted" x="40" y="${legendY}" font-size="12">pointer event, button up</text>
<circle cx="208" cy="${legendY - 4}" r="2.8" fill="#2f5bea"/><text class="muted" x="218" y="${legendY}" font-size="12">button down</text>
<circle cx="318" cy="${legendY - 4}" r="6" fill="none" stroke="#2f5bea" stroke-width="2"/><text class="muted" x="330" y="${legendY}" font-size="12">press</text>
<circle cx="390" cy="${legendY - 4}" r="6" fill="none" stroke="#1a7f4b" stroke-width="2"/><text class="muted" x="402" y="${legendY}" font-size="12">release</text>
<text class="muted" x="${W - 24}" y="${legendY}" font-size="12" text-anchor="end">Wider spacing between dots = faster movement.</text>`;
  return renderer.writeSvg("method-gestures.svg", svgDocument(W, H, `${SVG_THEME}\n${tl.css()}`, body, "Human-like pointer tracks: click, slider drag, press and hold"));
}
