/**
 * social.png: the repository's social preview (GitHub, og:image, twitter:card large image),
 * exactly 1280×640, everything that matters inside a 64 px safe margin. A collage of the real
 * material of the other figures, and counts read from the adapters and benchmarks/verified.json.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { BUILTIN_ADAPTERS } from "../../core/adapters/index";
import { coverage, type Verified } from "../benchmark/coverage";
import { heroRound } from "./hero";
import { providers } from "./providers";
import { COLOR, escapeHtml, fileUrl, OUT, readJson, ROOT, type Renderer } from "./render";
import { heatmap, shiftSolve } from "./shift";
import { sliderSolve } from "./slider";

const [W, H] = [1280, 640];
const REPO = "github.com/samuelscheit/llm-captcha";
const PITCH = "Gets browser agents through captchas: a vision model where it needs eyes, image analysis where it needs precision.";
/** Live widget captures (docs/img/providers/raw/) in the collage: recognizable at a glance. */
const WIDGETS = ["human", "turnstile"];

/** The labeled reCAPTCHA view with the model's picks filled and numbered in click order. */
function recaptchaCard(height: number): string {
  const { dir, image, targets, toImage, scale } = heroRound();
  // Card px per image px.
  const k = height / image.height;
  const picks = targets
    .filter((t) => t.id !== "verify")
    .map((t, i) => {
      const a = toImage(t.rect);
      const [w, h] = [t.rect.width * scale * k, t.rect.height * scale * k];
      return `<div class="pick" style="left:${a.x * k + 2}px;top:${a.y * k + 2}px;width:${w - 4}px;height:${h - 4}px"><b>${i + 1}</b></div>`;
    })
    .join("");
  return `<div class="card recaptcha"><div class="stack"><img src="${fileUrl(`${dir}/labeled.png`)}" height="${height}">${picks}</div></div>`;
}

/** The Tencent piece moved into the gap it found, over the score curve with its peak. */
function sliderCard(width: number): string {
  const { dir, background, piece, origin, offset, scores } = sliderSolve();
  const k = width / background.width;
  const [cw, ch] = [width, 46];
  const ys = scores.map(([, s]) => s);
  const [lo, hi] = [Math.min(...ys), Math.max(...ys)];
  const xs = scores.map(([x]) => x);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const X = (x: number) => ((x - x0) / (x1 - x0)) * cw;
  const Y = (y: number) => 4 + (1 - (y - lo) / (hi - lo)) * (ch - 8);
  const line = scores.map(([x, y], i) => `${i ? "L" : "M"}${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join("");
  return `<div class="card slider">
<div class="stack"><img src="${fileUrl(`${dir}/background.png`)}" width="${width}"><img src="${fileUrl(`${dir}/piece.png`)}" style="position:absolute;left:${(origin.x + offset) * k}px;top:${origin.y * k}px;width:${piece.width * k}px;filter:drop-shadow(0 2px 5px rgba(0,0,0,.5))"></div>
<svg width="${cw}" height="${ch}" style="display:block;margin-top:8px"><path d="${line}" fill="none" stroke="${COLOR.text}" stroke-width="1.6"/><circle cx="${X(offset)}" cy="${Y(hi)}" r="5" fill="${COLOR.accent}" stroke="#fff" stroke-width="2"/></svg>
<p class="tag">gap at <b>+${offset} px</b></p></div>`;
}

function shiftCard(size: number): string {
  const { fixture, scores, dx, dy } = shiftSolve();
  return `<div class="card shift">${heatmap(scores, fixture.grid, { dx, dy }, size, false)}<p class="tag">roll <b>(${dx}, ${dy})</b> of 100</p></div>`;
}

export async function socialFigure(renderer: Renderer): Promise<string> {
  const verified = readJson<Verified>(path.join(ROOT, "benchmarks/verified.json"));
  const rows = coverage(BUILTIN_ADAPTERS, verified);
  const live = rows.filter((r) => r.verification.passedAt && !r.verification.failedAt).length;
  const widgets = WIDGETS.map((name) => {
    const file = path.join(OUT, "providers/raw", `${name}.png`);
    if (!existsSync(file)) throw new Error(`${file} is missing: run bun run docs -- --capture ${name}.`);
    return `<div class="card widget w-${name}"><img src="${fileUrl(file)}"></div>`;
  }).join("");
  const stat = (n: number, label: string) => `<div class="stat"><b>${n}</b><span>${label}</span></div>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0}
#s{position:relative;width:${W}px;height:${H}px;overflow:hidden;font-family:system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:${COLOR.text};
background:radial-gradient(900px 600px at 100% 0%,#e6ecfd 0%,rgba(230,236,253,0) 60%),radial-gradient(700px 500px at 75% 110%,#e5f2ea 0%,rgba(229,242,234,0) 60%),#fbfbf9}
.left{position:absolute;left:64px;top:64px;width:560px;height:${H - 128}px;display:flex;flex-direction:column}
.pill{align-self:flex-start;font-size:17px;font-weight:650;color:${COLOR.accent};background:#e8eefc;border-radius:999px;padding:6px 14px;margin-bottom:22px}
h1{font-size:82px;line-height:.98;letter-spacing:-.035em;margin:0 0 22px;font-weight:800}
h1 em{font-style:normal;color:${COLOR.accent}}
.pitch{font-size:25px;line-height:1.36;color:#3b3a37;margin:0}
.stats{display:flex;gap:34px;margin-top:auto}
.stat b{display:block;font-size:46px;line-height:1;font-weight:800;letter-spacing:-.02em;color:${COLOR.text}}
.stat span{display:block;font-size:17px;color:${COLOR.muted};margin-top:6px}
.stat.good b{color:${COLOR.good}}
.repo{font-size:19px;font-weight:600;color:${COLOR.muted};margin-top:22px;font-family:ui-monospace,"SF Mono",Menlo,monospace}
.card{position:absolute;background:#fff;border:1px solid ${COLOR.line};border-radius:14px;padding:10px;box-shadow:0 2px 4px rgba(0,0,0,.05),0 18px 40px rgba(30,40,80,.16)}
.card img{display:block;border-radius:6px}.stack{position:relative}
.recaptcha{left:664px;top:72px;transform:rotate(-3deg)}
.pick{position:absolute;background:rgba(47,91,234,.30);border:3px solid ${COLOR.accent};border-radius:3px}
.pick b{position:absolute;right:4px;top:4px;width:22px;height:22px;border-radius:50%;background:${COLOR.accent};color:#fff;font-size:13px;display:grid;place-items:center;border:2px solid #fff}
.slider{left:948px;top:70px;transform:rotate(2.5deg)}
.shift{left:1044px;top:340px;transform:rotate(-2.5deg)}
.tag{margin:6px 2px 0;font-size:15px;color:${COLOR.muted}}.tag b{color:${COLOR.text}}
.widget img{width:164px;height:auto}
.w-human{left:670px;top:482px;transform:rotate(-2.5deg)}
.w-turnstile{left:866px;top:474px;transform:rotate(2deg)}
</style></head><body><div id="s">
<div class="left">
<span class="pill">Open source · for AI browser agents</span>
<h1>LLM Captcha <em>Solver</em></h1>
<p class="pitch">${escapeHtml(PITCH)}</p>
<div class="stats">${stat(providers().length, "providers")}${stat(BUILTIN_ADAPTERS.length, "challenge types")}<div class="stat good"><b>${live}</b><span>verified on the real widget</span></div></div>
<div class="repo">${REPO}</div>
</div>
${recaptchaCard(372)}
${sliderCard(244)}
${shiftCard(136)}
${widgets}
</div></body></html>`;
  return renderer.shoot("social.png", html, "#s", W, 1);
}
