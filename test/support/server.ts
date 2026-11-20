/**
 * Local challenge pages with known answers, plus a mock OpenAI-compatible model that answers from
 * that ground truth. Challenge widgets are served from 127.0.0.1 and embedded in pages on
 * localhost, so Chrome renders them out of process like real vendor iframes.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { BUILTIN_ADAPTERS } from "../../src/core/adapters";
import type { AdapterSpec, Decision } from "../../src/core/types";
import { loadPageFixtures, loadSliderFixtures } from "../../src/tools/fixtures";

type Shape = "circle" | "square" | "triangle";

export interface ServerState {
  text: string;
  textSubmitted: string[];
  grid: Shape[];
  gridVerified: number;
  /** When the grid widget last fetched its tiles (replacement tiles then fade in for 1.5 s). */
  gridLoadedAt: number;
  point: { x: number; y: number; r: number };
  pointClicks: { x: number; y: number }[];
  /** Distances from the moving circle at each click of the animated widget. */
  animMisses: number[];
  /** Tencent slide puzzle: which real puzzle is shown, and each release's error in CSS px. */
  tencent: { puzzle: number; misses: number[]; solved: number };
  /** Slide-to-end look-alikes: every release, with how far short of the end and whether the track went back. */
  slides: { variant: string; short: number; backwards: boolean; passed: boolean }[];
  /** Model requests the mock received, newest last: prompt, last image, image count, time. */
  modelCalls: { prompt: string; image: string; images: number; at: number }[];
}

export interface MockBehaviour {
  /** Answer wrong this many times first, to exercise error feedback. */
  wrongFirst: number;
}

const rand = (n: number) => Math.floor(Math.random() * n);
const pick = <T>(xs: readonly T[]) => xs[rand(xs.length)]!;

function newGrid(): Shape[] {
  const shapes: Shape[] = Array.from({ length: 9 }, () => pick(["square", "triangle"] as const));
  const circles = new Set<number>();
  while (circles.size < 2 + rand(3)) circles.add(rand(9));
  for (const i of circles) shapes[i] = "circle";
  return shapes;
}

const newText = () => Array.from({ length: 6 }, () => pick([..."ABCDEFHJKLMNPRSTUVWXYZ23456789"])).join("");
const newPoint = () => ({ x: 40 + rand(320), y: 40 + rand(170), r: 22 });

function shapeSvg(shape: Shape, hue: number): string {
  const fill = `hsl(${hue} 65% 45%)`;
  const body =
    shape === "circle"
      ? `<circle cx="50" cy="50" r="30" fill="${fill}"/>`
      : shape === "square"
        ? `<rect x="22" y="22" width="56" height="56" fill="${fill}"/>`
        : `<polygon points="50,18 84,80 16,80" fill="${fill}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="hsl(${(hue + 180) % 360} 30% 88%)"/>${body}</svg>`;
}

function textSvg(text: string): string {
  const chars = [...text]
    .map((c, i) => `<text x="${18 + i * 26}" y="${40 + rand(10)}" transform="rotate(${rand(30) - 15} ${18 + i * 26} 36)" font-family="Georgia, serif" font-size="30" font-weight="bold" fill="hsl(${rand(360)} 50% 30%)">${c}</text>`)
    .join("");
  const noise = Array.from({ length: 5 }, () => `<line x1="${rand(180)}" y1="${rand(60)}" x2="${rand(180)}" y2="${rand(60)}" stroke="#888" stroke-width="1.5"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="60"><rect width="180" height="60" fill="#f1ede4"/>${chars}${noise}</svg>`;
}

const page = (title: string, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
body{font:15px system-ui;margin:24px} #challenge{width:420px;border:1px solid #ccc;border-radius:8px;padding:12px;background:#fff}
#instruction{font-weight:600;margin-bottom:10px} .grid{display:grid;grid-template-columns:repeat(3,120px);gap:6px}
.tile{width:120px;height:120px;cursor:pointer;position:relative} .tile img{width:100%;height:100%;display:block}
.tile.fresh{animation:fadein 1.5s ease-out} @keyframes fadein{from{opacity:0}to{opacity:1}}
.tile.selected{outline:5px solid #2f5bea;outline-offset:-5px} .tile.selected::after{content:"✓";position:absolute;top:4px;left:8px;color:#fff;background:#2f5bea;border-radius:50%;width:22px;height:22px;text-align:center}
.error{color:#b3261e;margin-top:8px} #done{color:#1d7a46;font-weight:600;margin-top:8px} button{margin-top:10px;padding:8px 18px}
</style></head><body>${body}</body></html>`;

/** The real Tencent puzzles of fixtures/tencent/: piece origin and gap offset in image pixels. */
const TENCENT_PUZZLES = loadSliderFixtures("tencent/");
export const PAGE_FIXTURES = loadPageFixtures();

/**
 * Slide-to-end widgets with the DOM of each vendor. The same script drives them all: the handle
 * follows the pointer along the rail, a release within 5 px of the end passes. `refuseFirst`
 * refuses the first release like Aliyun's slider ("error, click to refresh").
 */
const SLIDES: Record<string, { dom: string; handle: string; rail: string; pass: string; refuseFirst?: boolean }> = {
  nc: {
    dom: `<div class="nc_wrapper"><div class="nc_scale" id="nc_1_n1t"><div class="nc_bg"></div><span class="nc_iconfont btn_slide" id="nc_1_n1z">›</span><div class="scale_text slidetounlock"><span class="nc-lang-cnt">Please slide to verify</span></div></div><div class="errloading" hidden>Oops, something went wrong. Click to refresh</div></div>`,
    handle: ".btn_slide",
    rail: ".nc_scale",
    pass: "handle.classList.replace('btn_slide', 'btn_ok')",
    refuseFirst: true,
  },
  gname: {
    dom: `<div class="gn-slide-verify"><div class="gn-slide-rail"><div class="gn-slide-bar">⇢</div></div></div>`,
    handle: ".gn-slide-bar",
    rail: ".gn-slide-rail",
    pass: "document.querySelector('.gn-slide-verify').remove()",
  },
  datadome: {
    dom: `<div id="captcha__frame" class="simple"><div class="sliderContainer"><div class="sliderMask"></div><div class="slider">→</div><div class="sliderTarget"></div></div></div>`,
    handle: ".slider",
    rail: ".sliderContainer",
    pass: "rail.classList.add('slider-success')",
  },
};

const slidePage = (variant: string) => {
  const s = SLIDES[variant]!;
  return page(`Slide ${variant}`, `<style>
${s.rail}{position:relative;width:300px;height:40px;background:#e5e5e5;border-radius:4px;user-select:none}
${s.handle}{position:absolute;left:0;top:0;width:42px;height:40px;background:#1e6fff;color:#fff;display:flex;align-items:center;justify-content:center;cursor:grab}
.btn_ok{position:absolute;left:258px;top:0;width:42px;height:40px;background:#1d7a46}
.errloading{color:#c53030;cursor:pointer;margin-top:6px} .slider-success{background:#c8efd6}
.sliderTarget{position:absolute;right:0;top:0;width:42px;height:40px;border:2px dashed #999;box-sizing:border-box}
</style>
<p>Verify you are human</p>${s.dom}
<script>
const rail = document.querySelector('${s.rail}'); let handle = document.querySelector('${s.handle}');
const max = () => rail.clientWidth - handle.offsetWidth;
let start = null, left = 0, furthest = 0, backwards = false, refuse = ${!!s.refuseFirst};
function arm(h) { h.onmousedown = (e) => { start = e.clientX; left = 0; furthest = 0; backwards = false; }; }
arm(handle);
addEventListener('mousemove', (e) => { if (start === null) return; const x = e.clientX - start;
  if (x < furthest - 0.5 && x < max()) backwards = true; furthest = Math.max(furthest, x); left = Math.max(0, Math.min(max(), x)); handle.style.left = left + 'px'; });
addEventListener('mouseup', async () => { if (start === null) return; start = null;
  const passed = left >= max() - 5 && !refuse;
  await fetch('/slide/release', { method: 'POST', body: JSON.stringify({ variant: '${variant}', short: max() - left, backwards, passed }) });
  if (passed) { ${s.pass}; return; }
  handle.style.left = '0px';
  if (refuse) { refuse = false; handle.hidden = true; const err = document.querySelector('.errloading'); err.hidden = false;
    err.onclick = () => { err.hidden = true; handle.hidden = false; }; }
});
</script>`);
};

/** The DataDome adapter for the look-alike: same DOM selectors, the local frame's URL. */
export const TEST_DATADOME: AdapterSpec = { ...BUILTIN_ADAPTERS.find((a) => a.id === "datadome-slider")!, id: "test-datadome", url: String.raw`/slide/datadome` };

/** Official test sitekeys: the checkbox always passes (Turnstile's forces the interactive checkbox). */
export const VENDORS = {
  turnstile: { class: "cf-turnstile", sitekey: "3x00000000000000000000FF", script: "https://challenges.cloudflare.com/turnstile/v0/api.js", token: "cf-turnstile-response" },
  recaptcha: { class: "g-recaptcha", sitekey: "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI", script: "https://www.google.com/recaptcha/api.js", token: "g-recaptcha-response" },
  hcaptcha: { class: "h-captcha", sitekey: "10000000-ffff-ffff-ffff-000000000001", script: "https://js.hcaptcha.com/1/api.js", token: "h-captcha-response" },
} as const;

/** Adapters for the local widgets, configured like a user's custom adapters. */
export const TEST_ADAPTERS: AdapterSpec[] = [
  {
    id: "test-grid",
    kind: "select",
    url: String.raw`127\.0\.0\.1:\d+/grid`,
    root: "#challenge",
    instruction: ["#instruction"],
    errors: [".error"],
    solved: "#done",
    targets: [
      { id: "t", selector: ".tile", all: true, selected: ".selected" },
      { id: "verify", selector: "#verify", labelFromText: true },
    ],
  },
  {
    id: "test-point",
    kind: "point",
    url: String.raw`127\.0\.0\.1:\d+/point`,
    root: "#challenge",
    instruction: ["#instruction"],
    errors: [".error"],
    solved: "#done",
    targets: [
      { id: "canvas", selector: "canvas" },
      { id: "submit", selector: "#submit", labelFromText: true },
    ],
  },
  {
    id: "test-anim",
    kind: "point",
    url: String.raw`127\.0\.0\.1:\d+/anim`,
    root: "#challenge",
    instruction: ["#instruction"],
    errors: [".error"],
    solved: "#done",
    targets: [{ id: "submit", selector: "#submit", labelFromText: true }],
  },
];

export interface TestServer {
  /** Page origin (localhost). */
  origin: string;
  /** Widget origin (127.0.0.1), cross-site to `origin`. */
  widgetOrigin: string;
  /** OpenAI-compatible base URL of the mock model. */
  modelURL: string;
  state: ServerState;
  mock: MockBehaviour;
  close(): Promise<void>;
}

function body(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

/** Image box of a target as the prompt lists it ("- canvas: x=12 y=40 w=400 h=250"). */
function promptBox(prompt: string, id: string) {
  const m = new RegExp(`- ${id}: x=(-?\\d+) y=(-?\\d+) w=(\\d+) h=(\\d+)`).exec(prompt);
  if (!m) throw new Error(`target ${id} missing from prompt`);
  const [x, y, w, h] = m.slice(1).map(Number) as [number, number, number, number];
  return { x, y, w, h };
}

function mockDecision(state: ServerState, mock: MockBehaviour, prompt: string): Decision {
  const wrong = mock.wrongFirst > 0;
  if (wrong) mock.wrongFirst--;
  const action = (kind: Decision["actions"][number]["kind"], extra: Partial<Decision["actions"][number]> = {}) => ({
    kind, target: null, text: null, x: null, y: null, toX: null, toY: null, ...extra,
  });
  if (prompt.includes("(test-grid)")) {
    const tiles = state.grid.map((s, i) => ({ s, id: `t${i + 1}` })).filter(({ s }) => (wrong ? s !== "circle" : s === "circle"));
    return { reasoning: "mock grid", actions: [...tiles.map(({ id }) => action("click", { target: id })), action("click", { target: "verify" })] };
  }
  if (prompt.includes("(test-point)")) {
    const canvas = promptBox(prompt, "canvas");
    const scale = canvas.w / 400;
    const p = wrong ? { x: 5, y: 5 } : state.point;
    return {
      reasoning: "mock point",
      actions: [action("clickPoint", { x: canvas.x + p.x * scale, y: canvas.y + p.y * scale }), action("click", { target: "submit" })],
    };
  }
  if (prompt.includes("(test-anim)")) {
    const m = /- m1: x=(\d+) y=(\d+) w=(\d+) h=(\d+)/.exec(prompt);
    if (!m) return { reasoning: "mock anim: no motion listed", actions: [action("wait")] };
    const [x, y, w, h] = m.slice(1).map(Number) as [number, number, number, number];
    return { reasoning: "mock anim", actions: [action("clickPoint", { x: x + w / 2, y: y + h / 2 }), action("click", { target: "submit" })] };
  }
  if (prompt.includes("(text-image)")) {
    return { reasoning: "mock text", actions: [action("type", { target: "input", text: wrong ? "WRONG1" : state.text })] };
  }
  return { reasoning: "mock: unknown challenge", actions: [] };
}

export async function startServer(): Promise<TestServer> {
  const state: ServerState = {
    text: newText(), textSubmitted: [], grid: newGrid(), gridVerified: 0, gridLoadedAt: 0, point: newPoint(), pointClicks: [], animMisses: [],
    tencent: { puzzle: 0, misses: [], solved: 0 }, slides: [], modelCalls: [],
  };
  const mock: MockBehaviour = { wrongFirst: 0 };
  let origin = "";
  let widgetOrigin = "";

  const routes: Record<string, (req: http.IncomingMessage, url: URL) => Promise<[string, string]> | [string, string]> = {
    "/text": () => {
      state.text = newText();
      return ["text/html", page("Text", `<div style="height:1400px">Scroll down</div>
<form id="form" method="post" action="/text/verify"><img src="/captcha.svg?${Date.now()}" alt="captcha" width="180" height="60"><br>
<input name="captcha" autocomplete="off"><button>Submit</button></form><div id="result"></div>
<script>form.onsubmit=async e=>{e.preventDefault();const r=await fetch('/text/verify',{method:'POST',body:form.captcha.value});result.textContent=await r.text()}</script>`)];
    },
    "/captcha.svg": () => ["image/svg+xml", textSvg(state.text)],
    "/text/verify": async (req) => {
      const value = await body(req);
      state.textSubmitted.push(value);
      return ["text/plain", value === state.text ? "correct" : "wrong"];
    },
    "/grid": () => ["text/html", page("Grid", `<div id="challenge"><div id="instruction">Select all images with circles</div><div class="grid" id="tiles"></div>
<div class="error" hidden>Please try again.</div><button id="verify">Verify</button><div id="done" hidden>Verified</div></div>
<script>
let first=true;
async function load(){const s=await (await fetch('/grid/state')).json();tiles.replaceChildren(...s.map(src=>{const d=document.createElement('div');d.className=first?'tile':'tile fresh';d.innerHTML='<img src="'+src+'">';d.onclick=()=>d.classList.toggle('selected');return d}));first=false}
verify.onclick=async()=>{const sel=[...tiles.children].map((t,i)=>t.classList.contains('selected')?i:-1).filter(i=>i>=0);
const ok=await (await fetch('/grid/verify',{method:'POST',body:JSON.stringify(sel)})).json();
document.querySelector('.error').hidden=ok; if(ok){done.hidden=false;verify.hidden=true}else load()}
load()</script>`)],
    "/grid/state": () => {
      state.gridLoadedAt = Date.now();
      return ["application/json", JSON.stringify(state.grid.map((s) => `data:image/svg+xml;base64,${Buffer.from(shapeSvg(s, rand(360))).toString("base64")}`))];
    },
    "/grid/verify": async (req) => {
      const selected = (JSON.parse(await body(req)) as number[]).sort((a, b) => a - b);
      const truth = state.grid.flatMap((s, i) => (s === "circle" ? [i] : []));
      const ok = JSON.stringify(selected) === JSON.stringify(truth);
      state.gridVerified += ok ? 1 : 0;
      if (!ok) state.grid = newGrid();
      return ["application/json", JSON.stringify(ok)];
    },
    "/point": () => ["text/html", page("Point", `<div id="challenge"><div id="instruction">Click the red circle</div>
<canvas id="c" width="400" height="250" style="width:400px;height:250px;display:block;background:#eef"></canvas>
<div class="error" hidden>Please try again.</div><button id="submit">Submit</button><div id="done" hidden>Verified</div></div>
<script>
let clicks=[];
async function load(){const p=await (await fetch('/point/state')).json();const g=c.getContext('2d');g.clearRect(0,0,400,250);clicks=[];
for(const d of p.decoys){g.fillStyle=d.color;g.beginPath();g.arc(d.x,d.y,20,0,7);g.fill()}
g.fillStyle='#d01818';g.beginPath();g.arc(p.x,p.y,20,0,7);g.fill()}
c.onclick=e=>{const r=c.getBoundingClientRect();clicks.push({x:e.clientX-r.left,y:e.clientY-r.top})};
submit.onclick=async()=>{const ok=await (await fetch('/point/verify',{method:'POST',body:JSON.stringify(clicks)})).json();
document.querySelector('.error').hidden=ok;if(ok){done.hidden=false;submit.hidden=true}else load()}
load()</script>`)],
    "/point/state": () => {
      const decoys = Array.from({ length: 4 }, () => ({ ...newPoint(), color: pick(["#1858d0", "#18a050", "#d0a018"]) }));
      return ["application/json", JSON.stringify({ ...state.point, decoys })];
    },
    "/point/verify": async (req) => {
      const clicks = JSON.parse(await body(req)) as { x: number; y: number }[];
      state.pointClicks.push(...clicks);
      const ok = clicks.length > 0 && clicks.every((c) => Math.hypot(c.x - state.point.x, c.y - state.point.y) <= state.point.r);
      if (!ok) state.point = newPoint();
      return ["application/json", JSON.stringify(ok)];
    },
    // A circle that drifts slowly back and forth among static decoys. Slow enough that a click
    // aimed at where it moved during the burst still lands on it.
    "/anim": () => ["text/html", page("Anim", `<div id="challenge"><div id="instruction">Click the moving circle</div>
<canvas id="c" width="400" height="250" style="width:400px;height:250px;display:block;background:#eef"></canvas>
<div class="error" hidden>Please try again.</div><button id="submit">Submit</button><div id="done" hidden>Verified</div></div>
<script>
const decoys=[[60,60],[330,70],[90,200],[320,200]];let pos=[200,125];let hit=false;const t0=performance.now();
function frame(t){const s=(t-t0)/1000;pos=[200+60*Math.sin(s*0.35),125+25*Math.cos(s*0.3)];const g=c.getContext('2d');g.clearRect(0,0,400,250);
g.fillStyle='#1858d0';for(const [x,y] of decoys){g.beginPath();g.arc(x,y,22,0,7);g.fill()}g.beginPath();g.arc(pos[0],pos[1],22,0,7);g.fill();requestAnimationFrame(frame)}
requestAnimationFrame(frame);
c.onclick=e=>{const r=c.getBoundingClientRect();const d=Math.hypot(e.clientX-r.left-pos[0],e.clientY-r.top-pos[1]);hit=d<=30;fetch('/anim/click',{method:'POST',body:String(d)})};
submit.onclick=()=>{document.querySelector('.error').hidden=hit;if(hit){done.hidden=false;submit.hidden=true}}
</script>`)],
    "/anim/click": async (req) => {
      state.animMisses.push(Number(await body(req)));
      return ["text/plain", "ok"];
    },
    "/slide/release": async (req) => {
      state.slides.push(JSON.parse(await body(req)));
      return ["application/json", "true"];
    },
    "/landed": () => ["text/html", page("Landed", "<h1>Landed</h1>")],
    /** A real vendor widget with its official always-pass test sitekey. */
    "/vendor": (_req, url) => {
      const vendor = VENDORS[url.searchParams.get("kind") as keyof typeof VENDORS];
      return ["text/html", page("Vendor", `<form><div class="${vendor.class}" data-sitekey="${vendor.sitekey}"></div></form><script src="${vendor.script}" async defer></script>`)];
    },
    // A look-alike of Tencent's TCaptcha frame (same ids and layout) with the real puzzles of
    // test/assets/tencent-slider at half size. Piece and handle move together; a release within
    // 4 px of the gap passes, anything else shows the error and the next puzzle.
    "/tencent/cap_union_new_show": () => ["text/html", page("TCaptcha", `<style>
body{margin:0;width:360px} #tcOperation{position:relative;padding:10px}
.tc-bg{position:relative;width:340px;height:195px} #slideBg{width:340px;height:195px;display:block}
#slideBlock{position:absolute;width:68px;height:68px}
.tc-drag{position:relative;height:45px;margin-top:8px} .tc-drag-track{position:absolute;top:16px;left:0;right:0;height:14px;background:#e5e5e5;border-radius:7px}
#tcaptcha_drag_button{position:absolute;top:5px;left:26px;width:65px;height:36px;background:#1e6fff;border-radius:18px;cursor:grab}
.tc-cover{position:absolute;inset:0;visibility:hidden;display:flex;align-items:center;justify-content:center;font-weight:600}
.tc-success{background:rgba(255,255,255,.9);color:#1d7a46} #statusError{color:#c53030;min-height:18px}
</style>
<div id="tcOperation"><p id="guideText">Drag the slider below to fit the puzzle piece</p>
<div class="tc-bg"><img id="slideBg"><img id="slideBlock"><div class="tc-cover tc-success">Verified</div></div>
<div id="slide" class="tc-drag"><div class="tc-drag-track"></div><div id="tcaptcha_drag_button"></div></div>
<div id="statusError"></div><div id="reload">↻</div></div>
<script>
let origin, start = null, dx = 0;
async function load(){ const p = await (await fetch('/tencent/state')).json(); origin = p.origin; dx = 0; place();
  slideBg.src = '/tencent/img/' + p.index + '/background.png?' + Date.now(); slideBlock.src = '/tencent/img/' + p.index + '/piece.png?' + Date.now(); }
function place(){ slideBlock.style.left = (origin.x / 2 + dx) + 'px'; slideBlock.style.top = (origin.y / 2) + 'px'; tcaptcha_drag_button.style.left = (26 + dx) + 'px'; }
tcaptcha_drag_button.onmousedown = e => { start = e.clientX; statusError.textContent = ''; };
addEventListener('mousemove', e => { if (start !== null) { dx = Math.max(0, e.clientX - start); place(); } });
addEventListener('mouseup', async () => { if (start === null) return; start = null;
  const ok = await (await fetch('/tencent/verify', { method: 'POST', body: String(dx) })).json();
  if (ok) document.querySelector('.tc-success').style.visibility = 'visible'; else { statusError.textContent = 'Please try again'; setTimeout(load, 600); } });
reload.onclick = load;
load();
</script>`)],
    "/tencent/state": () => {
      const index = state.tencent.puzzle % TENCENT_PUZZLES.length;
      return ["application/json", JSON.stringify({ index, origin: TENCENT_PUZZLES[index]!.origin })];
    },
    "/tencent/verify": async (req) => {
      const dx = Number(await body(req));
      const puzzle = TENCENT_PUZZLES[state.tencent.puzzle % TENCENT_PUZZLES.length]!;
      const miss = Math.abs(dx - puzzle.expected.offset / 2);
      state.tencent.misses.push(miss);
      const ok = miss <= 4;
      if (ok) state.tencent.solved++;
      else state.tencent.puzzle++;
      return ["application/json", JSON.stringify(ok)];
    },
    /** A page on localhost that embeds a widget from 127.0.0.1, below a scrolled offset. */
    "/host": (_req, url) => ["text/html", page("Host", `<h1>Host page</h1><div style="height:${url.searchParams.get("offset") ?? 0}px"></div>
<iframe src="${widgetOrigin}/${url.searchParams.get("widget")}" style="width:460px;height:${url.searchParams.get("widget") === "grid" ? 560 : 420}px;border:8px solid #ddd;padding:4px"></iframe>`)],
    "/v1/chat/completions": async (req) => {
      const request = JSON.parse(await body(req)) as { messages: { role: string; content: string | { type: string; text?: string; image_url?: { url: string } }[] }[] };
      const user = request.messages.find((m) => m.role === "user")!;
      const parts = typeof user.content === "string" ? [{ type: "text", text: user.content }] : user.content;
      const prompt = parts.filter((p) => p.type === "text").map((p) => p.text).join("\n");
      const images = parts.filter((p) => p.type === "image_url").map((p) => p.image_url!.url);
      state.modelCalls.push({ prompt, image: images.at(-1) ?? "", images: images.length, at: Date.now() });
      const decision = mockDecision(state, mock, prompt);
      return ["application/json", JSON.stringify({
        id: "mock", object: "chat.completion", created: 0, model: "mock",
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(decision) } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })];
    },
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, "http://x");
    const slide = /^\/slide\/(\w+)$/.exec(url.pathname);
    if (slide && SLIDES[slide[1]!]) return void res.writeHead(200, { "content-type": "text/html" }).end(slidePage(slide[1]!));
    // Page fixtures as they were captured: /fixture/<provider>/<name>.
    const fixture = /^\/fixture\/([\w-]+\/[\w-]+)$/.exec(url.pathname);
    const pageFixture = fixture && PAGE_FIXTURES.find((f) => f.name === fixture[1]);
    if (pageFixture) return void res.writeHead(200, { "content-type": "text/html" }).end(pageFixture.html);
    const image = /^\/tencent\/img\/(\d+)\/(background|piece)\.png$/.exec(url.pathname);
    if (image) return void res.writeHead(200, { "content-type": "image/png" }).end(TENCENT_PUZZLES[Number(image[1])]![image[2] as "background" | "piece"]);
    const route = routes[url.pathname];
    if (!route) return void res.writeHead(404).end();
    const [type, content] = await route(req, url);
    res.writeHead(200, { "content-type": type, "access-control-allow-origin": "*", "access-control-allow-headers": "*" }).end(content);
  });
  await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
  const { port } = server.address() as AddressInfo;
  origin = `http://localhost:${port}`;
  widgetOrigin = `http://127.0.0.1:${port}`;
  return {
    origin,
    widgetOrigin,
    modelURL: `${origin}/v1`,
    state,
    mock,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
