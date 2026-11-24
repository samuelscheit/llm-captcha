/**
 * hero.svg: one real reCAPTCHA solve, animated. The raw frame of a recorded round, the same frame
 * with the target labels the model saw, the model's recorded answer, then the clicks in order along
 * the pointer track src/core/mouse.ts plans for them (seeded, real timings), and the solved check.
 */
import type { Fixture } from "../../core/fixture";
import { center } from "../../core/geometry";
import { clickSteps, seeded, type MouseStep, type Point } from "../../core/mouse";
import { escapeHtml, fixturePath, readJson, readPng, type Renderer } from "./render";
import { compactPngUrl, SVG_THEME, svgDocument, Timeline } from "./svg";
import { actionLabel, lastFrame } from "./vision";

const FIXTURE = "recaptcha/2026-11-20T21-27-27-321Z-recaptcha-images-r2";
const LOOP_MS = 8000;
const [W, H] = [960, 540];
/** Where the challenge sits in the card, and its display scale. */
const IMG = { x: 36, y: 32, scale: 0.82 };
const PANEL_X = 418;
/** Phases of the loop, ms. */
const T = { labels: 1300, answer: 2500, clicks: 3700, clicksEnd: 6500 };

/** Pointer arrow, tip at (0, 0). */
const ARROW = "M0,0 L0,17 L4.6,12.8 L7.6,19.6 L10.4,18.4 L7.4,11.8 L13.2,11.6 Z";

/** The hero's round: the fixture, its labeled image, the model's clicks and their targets in order. */
export function heroRound() {
  const dir = fixturePath(FIXTURE);
  const fixture = readJson<Fixture>(`${dir}/fixture.json`);
  const image = readPng(`${dir}/labeled.png`);
  const { region } = fixture.view;
  /** Image pixels per page CSS px. */
  const scale = image.width / region.width;
  const actions = fixture.observed!.decision.actions.filter((a) => a.kind === "click");
  const targets = actions.map((a) => fixture.view.targets.find((t) => t.id === a.target)!);
  /** Page CSS px → image px. */
  const toImage = (p: Point) => ({ x: (p.x - region.x) * scale, y: (p.y - region.y) * scale });
  return { dir, fixture, image, region, scale, actions, targets, toImage };
}

export function heroFigure(renderer: Renderer): Promise<string> {
  const { dir, fixture, image, region, scale, actions, targets, toImage } = heroRound();
  const k = scale * IMG.scale;
  // Page CSS px → card coordinates.
  const toCard = (p: Point) => ({ x: IMG.x + toImage(p).x * IMG.scale, y: IMG.y + toImage(p).y * IMG.scale });

  // The real pointer plan: each click starts where the last one ended, from a start right of the widget.
  const random = seeded(7);
  let from: Point = { x: region.x + region.width + 120, y: region.y + region.height * 0.55 };
  const presses: number[] = [];
  const track: { at: number; p: Point }[] = [{ at: 0, p: from }];
  let clock = 0;
  for (const target of targets) {
    const steps: MouseStep[] = clickSteps(center(target.rect), random, from);
    for (const step of steps) {
      if (step.type === "mousePressed") presses.push(clock);
      track.push({ at: clock, p: step });
      clock += step.delayMs;
    }
    from = steps.at(-1)!;
  }
  // Real timings, stretched evenly only if they would not fit the clicking phase.
  const stretch = Math.min(1, (T.clicksEnd - T.clicks) / clock);
  const time = (ms: number) => T.clicks + ms * stretch;
  const solvedAt = time(clock) + 250;

  const tl = new Timeline(LOOP_MS);
  const raw = compactPngUrl(lastFrame(dir));
  const labeled = compactPngUrl(`${dir}/labeled.png`);
  const [iw, ih] = [image.width * IMG.scale, image.height * IMG.scale];

  const pointerFrames: [number, string][] = [[0, `opacity:0;transform:translate(${toCard(track[0]!.p).x}px,${toCard(track[0]!.p).y}px)`]];
  pointerFrames.push([T.clicks - 300, `opacity:0;transform:translate(${toCard(track[0]!.p).x}px,${toCard(track[0]!.p).y}px)`]);
  for (const { at, p } of track) {
    const c = toCard(p);
    pointerFrames.push([time(at), `opacity:1;transform:translate(${c.x.toFixed(1)}px,${c.y.toFixed(1)}px)`]);
  }
  const last = toCard(track.at(-1)!.p);
  pointerFrames.push([solvedAt, `opacity:1;transform:translate(${last.x.toFixed(1)}px,${last.y.toFixed(1)}px)`]);
  pointerFrames.push([solvedAt + 300, `opacity:0;transform:translate(${last.x.toFixed(1)}px,${last.y.toFixed(1)}px)`]);

  const marks = targets
    .map((t, i) => {
      const a = toCard({ x: t.rect.x, y: t.rect.y });
      const [w, h] = [t.rect.width * k, t.rect.height * k];
      const at = time(presses[i]!);
      const c = toCard(center(t.rect));
      const badge = t.id === "verify" ? "" : `<circle cx="${a.x + w - 13}" cy="${a.y + 13}" r="10" fill="#2f5bea" stroke="#fff" stroke-width="2"/><text x="${a.x + w - 13}" y="${a.y + 17.5}" text-anchor="middle" font-size="11.5" font-weight="700" fill="#fff">${i + 1}</text>`;
      return `<g ${tl.appear(at, 120)}><rect x="${a.x + 2}" y="${a.y + 2}" width="${w - 4}" height="${h - 4}" rx="3" fill="rgba(47,91,234,.22)" stroke="#2f5bea" stroke-width="3.5"/>${badge}</g>
<g ${tl.keyframes([[0, "opacity:0;transform:scale(.2)"], [at, "opacity:0;transform:scale(.2)"], [at + 40, "opacity:.9;transform:scale(.4)"], [at + 520, "opacity:0;transform:scale(1.6)"], [LOOP_MS, "opacity:0;transform:scale(1.6)"]], "transform-box:fill-box;transform-origin:center;opacity:0")}><circle cx="${c.x}" cy="${c.y}" r="18" fill="none" stroke="#2f5bea" stroke-width="3"/></g>`;
    })
    .join("\n");

  const steps = [
    { at: 0, title: "Screenshot the challenge", detail: "The frame as the page shows it, nothing from its DOM." },
    { at: T.labels, title: "Label every target", detail: `${fixture.view.targets.length} targets outlined, each with a short id.` },
    { at: T.answer, title: "Ask a vision model", detail: "" },
    { at: T.clicks, title: "Click like a person", detail: "Eased approach, small jitter, press, release." },
    { at: solvedAt, title: "Solved", detail: "Google accepted the answer; the page goes on." },
  ];
  const chips: string[] = [];
  let chipX = PANEL_X + 44;
  actions.forEach((a, i) => {
    const label = actionLabel(a);
    const w = label.length * 8.2 + 16;
    chips.push(`<g ${tl.appear(T.answer + 250 + i * 110, 120)}><rect class="chipbg" x="${chipX}" y="${0}" width="${w}" height="22" rx="11"/><text class="chiptext mono" x="${chipX + w / 2}" y="15.5" text-anchor="middle" font-size="12.5" font-weight="600">${escapeHtml(label)}</text></g>`);
    chipX += w + 6;
  });
  const stepY = (i: number) => 112 + i * 76;
  const stepList = steps
    .map((s, i) => {
      const y = stepY(i);
      const done = i === steps.length - 1;
      const detail = i === 2 ? `<g transform="translate(0,${y + 12})">${chips.join("")}</g>` : `<text class="muted" x="${PANEL_X + 44}" y="${y + 28}" font-size="13.5">${escapeHtml(s.detail)}</text>`;
      // The first step is there from the start: no moment of the loop shows an empty panel.
      return `<g ${s.at > 0 ? tl.appear(s.at, 250) : ""}>
<circle class="${done ? "good" : "accent"}" cx="${PANEL_X + 14}" cy="${y}" r="14"/>
${done ? `<path d="M${PANEL_X + 7.5},${y} l4.5,4.5 l8.5,-9" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>` : `<text x="${PANEL_X + 14}" y="${y + 4.8}" text-anchor="middle" font-size="13" font-weight="700" fill="#fff">${i + 1}</text>`}
<text class="ink" x="${PANEL_X + 44}" y="${y + 5}" font-size="17" font-weight="650">${escapeHtml(s.title)}</text>
${detail}</g>`;
    })
    .join("\n");

  const imgCenter = { x: IMG.x + iw / 2, y: IMG.y + ih / 2 };
  const body = `<rect class="card" x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12"/>
<g><image x="${IMG.x}" y="${IMG.y}" width="${iw}" height="${ih}" href="${raw}"/>
<g ${tl.appear(T.labels, 400)}><image x="${IMG.x}" y="${IMG.y}" width="${iw}" height="${ih}" href="${labeled}"/></g>
<rect x="${IMG.x - 0.5}" y="${IMG.y - 0.5}" width="${iw + 1}" height="${ih + 1}" rx="2" fill="none" class="line" stroke-width="1"/></g>
${marks}
<g ${tl.appear(solvedAt, 250)}><rect x="${IMG.x}" y="${IMG.y}" width="${iw}" height="${ih}" fill="rgba(255,255,255,.72)"/>
<circle cx="${imgCenter.x}" cy="${imgCenter.y}" r="46" fill="#1a7f4b"/><path d="M${imgCenter.x - 21},${imgCenter.y + 1} l14,14 l28,-30" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
<text x="${imgCenter.x}" y="${imgCenter.y + 84}" text-anchor="middle" font-size="20" font-weight="700" fill="#1a7f4b">Solved</text></g>
<g ${tl.keyframes(pointerFrames, "opacity:0")}><path d="${ARROW}" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></g>
<text class="muted" x="${PANEL_X}" y="58" font-size="12" font-weight="650" letter-spacing=".08em">ONE RECORDED SOLVE · RECAPTCHA V2</text>
${stepList}
<text class="muted" x="${PANEL_X}" y="${H - 30}" font-size="11.5">Replayed from fixtures/recaptcha/…-r2 (${escapeHtml(fixture.observed!.model)}); pointer track from src/core/mouse.ts.</text>`;
  return renderer.writeSvg("hero.svg", svgDocument(W, H, `${SVG_THEME}\n${tl.css()}`, body, "An LLM captcha solver solving a real reCAPTCHA: screenshot, labels, model answer, human-like clicks, solved"));
}
