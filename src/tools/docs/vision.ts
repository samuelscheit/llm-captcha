/**
 * method-vision.png: what the vision model is given and what it answers, for real recorded rounds
 * of reCAPTCHA, hCaptcha and Arkose: the raw frame, the same frame with the target labels the
 * model refers to, and its recorded decision, scored against the fixture's label.
 */
import { readdirSync } from "node:fs";
import type { Fixture } from "../../core/fixture";
import { score } from "../../core/score";
import type { Action } from "../../core/types";
import { COLOR, escapeHtml, fileUrl, fixturePath, readJson, readPng, type Renderer } from "./render";

/** Each row's image height: the Arkose sheet is wide, the others tall. */
const ROWS = [
  { provider: "reCAPTCHA", fixture: "recaptcha/2026-11-20T21-29-28-127Z-recaptcha-images-r3", height: 300 },
  { provider: "hCaptcha", fixture: "hcaptcha/2026-11-20T21-25-03-257Z-hcaptcha-challenge-r1", height: 280 },
  { provider: "Arkose", fixture: "arkose/2026-11-20T21-21-16-474Z-arkose-game-r1", height: 230 },
];

/** The last burst frame: the one labeled.png labels. */
export function lastFrame(dir: string): string {
  const frames = readdirSync(dir).filter((f) => /^frame-\d+\.png$/.test(f));
  frames.sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  return `${dir}/${frames.at(-1)}`;
}

export function actionLabel(a: Action): string {
  switch (a.kind) {
    case "click":
      return a.target!;
    case "clickPoint":
      return `(${a.x}, ${a.y})`;
    case "type":
      return `type “${a.text}”`;
    case "drag":
      return `drag (${a.x}, ${a.y}) → (${a.toX}, ${a.toY})`;
    default:
      return a.kind;
  }
}

/** The instruction as the page shows it, without the solver's own bracketed hint. */
export const pageInstruction = (s: string) => s.replace(/\s*\[[^\]]*\]\s*$/, "").trim();

/** "accounts.hcaptcha.com" from an auto-label note "Accepted by the vendor (accounts.hcaptcha.com, …". */
const acceptedBy = (notes: string) => notes.match(/^Accepted by the vendor \(([^,)]+)/)?.[1];

function row({ provider, fixture: name, height }: (typeof ROWS)[number], first: boolean): string {
  const dir = fixturePath(name);
  const fixture = readJson<Fixture>(`${dir}/fixture.json`);
  const decision = fixture.observed!.decision;
  const image = readPng(`${dir}/labeled.png`);
  const verdict = fixture.expected ? score(decision, fixture.expected, { width: image.width, height: image.height, scale: image.width / fixture.view.region.width }) : undefined;
  const width = Math.round((image.width / image.height) * height);
  const shot = (src: string, step: string) => `<div>${first ? step : ""}<img class="shot" src="${src}" width="${width}" height="${height}"></div>`;
  const chips = decision.actions.map((a) => `<span class="chip mono">${escapeHtml(actionLabel(a))}</span>`).join("");
  const vendor = acceptedBy(fixture.notes);
  const outcome = verdict?.pass
    ? `<span class="good">✓ matches the label${vendor ? `; accepted by ${escapeHtml(vendor)}` : ""}</span>`
    : `<span class="bad">✗ ${escapeHtml(verdict?.problems.join("; ") ?? "unlabeled")}</span>`;
  return `<section${first ? ' class="first"' : ""}>
<div class="provider">${provider}<span>“${escapeHtml(pageInstruction(fixture.view.instruction ?? ""))}”</span></div>
<div class="row">
${shot(fileUrl(lastFrame(dir)), '<p class="step"><b>1</b>Screenshot</p>')}
${shot(fileUrl(`${dir}/labeled.png`), '<p class="step"><b>2</b>Labeled targets</p>')}
<div class="answer">${first ? '<p class="step"><b>3</b>Model\'s answer</p>' : ""}
<div class="chips">${chips}</div>
<p class="why">${escapeHtml(decision.reasoning)}</p>
<p class="verdict">${outcome}<br><span class="model">${escapeHtml(fixture.observed!.model)}</span></p>
</div></div></section>`;
}

export async function visionFigure(renderer: Renderer): Promise<string> {
  const body = `<h1>What the model sees, and what it answers</h1>
<p class="lede">The solver screenshots the challenge, outlines every clickable target with a short id, and asks a vision model for actions in those ids (or in pixels, where the targets are free-form). It never sees the page's DOM; it sees what a person sees.</p>
${ROWS.map((r, i) => row(r, i === 0)).join("")}
<p class="foot">Recorded rounds from <span class="mono">fixtures/</span>, replayed by <span class="mono">bun run eval</span> · src/core/prompt.ts, src/core/engine.ts</p>`;
  return renderer.figure("method-vision.png", body, {
    width: 1120,
    css: `section{padding-top:18px;margin-top:20px;border-top:1px solid ${COLOR.line}}section.first{border-top:0;padding-top:0;margin-top:0}
.provider{font-weight:700;font-size:15px;margin:0 0 12px;display:flex;gap:12px;align-items:baseline}
.provider span{font-weight:400;color:${COLOR.muted};font-size:13.5px}
.row{display:flex;gap:24px;align-items:flex-end}
.answer{flex:1;align-self:center;min-width:300px}.first .answer{align-self:stretch;display:flex;flex-direction:column}.first .answer .chips{margin-top:auto}.first .answer .verdict{margin-bottom:auto}
.chips{margin-bottom:8px}.why{margin:0 0 10px;font-size:13px;color:${COLOR.text}}
.verdict{margin:0;font-size:12.5px;font-weight:600}.model{font-weight:400;color:${COLOR.muted}}`,
  });
}
