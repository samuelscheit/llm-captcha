/**
 * The "How it works" page: static prose and markup, the data computed at build time as embedded
 * JSON, and the vanilla script (client.js) and styles (style.css) that make it interactive.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { FRAME_INTERVAL_MS } from "../../../core/engine";
import { esc, REPO_URL, siteNav, socialMeta, THEME_CSS } from "../site";
import type { Action } from "../../../core/types";
import type { ExplainerData } from "./data";

const read = (file: string) => readFileSync(path.join(import.meta.dirname, file), "utf8");
const code = (file: string, label = file) => `<a href="${REPO_URL}/blob/main/${file}"><code>${esc(label)}</code></a>`;
/** JSON safe inside a <script> element. */
const embed = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

/** A compact, readable form of a model's actions. */
const actionText = (a: Action) =>
  a.kind === "click" ? `click ${a.target}` : a.kind === "type" ? `type "${a.text}"` : a.kind === "clickPoint" ? `clickPoint ${Math.round(a.x!)},${Math.round(a.y!)}` : a.kind === "drag" ? `drag ${Math.round(a.x!)},${Math.round(a.y!)} → ${Math.round(a.toX!)},${Math.round(a.toY!)}` : "wait";

interface Step {
  title: string;
  text: string;
  source: string;
  artefact: string;
}

/** The solve loop, illustrated with real rounds: an animated one the vendor accepted, and one it refused. */
function steps(data: ExplainerData): Step[] {
  const animated = data.rounds.find((r) => r.frames.length >= 3 && r.verdict?.pass && r.labeled && r.answer) ?? data.rounds[0]!;
  const refused = data.rounds.find((r) => r.errorsAfter.length) ?? animated;
  const view = {
    adapter: animated.adapter,
    kind: animated.kind,
    instruction: animated.instruction,
    targets: animated.targets.filter((t) => t.box).map((t) => t.id).join(" "),
  };
  const track = data.tracks.checkbox.points;
  const pts = track.map(([x, y]) => `${x},${y}`).join(" ");
  const pressed = track.find(([, , b]) => b)!;
  return [
    {
      title: "Scan",
      text: "Every frame of the page, out-of-process iframes and closed shadow roots included, is scanned with the adapters' selectors. Each match becomes a view: its kind, instruction, error text and the targets with their rectangles in page coordinates. An open challenge popup wins over the checkbox that opened it; it is scrolled into view, and whatever covers it (a cookie banner, a modal backdrop) is hidden first so clicks land on the challenge.",
      source: "src/page/scan.ts",
      artefact: `<figure><pre class="json">${esc(JSON.stringify(view, null, 1))}</pre><figcaption>The view scanned from <code>${esc(animated.id)}</code>.</figcaption></figure>`,
    },
    {
      title: "Settle",
      text: `The model is only asked about a challenge at rest. A view is <em>waiting</em> while an image loads or a CSS transition runs; the engine also captures a burst of frames ${FRAME_INTERVAL_MS} ms apart and compares them. A static challenge must not change at all; an animated one (hCaptcha fades shapes in and out) may move only in parts, and the moving regions are handed to the model.`,
      source: "src/core/engine.ts",
      artefact: `<figure><div class="thumbs">${animated.frames.map((src, i) => `<img src="${src}" alt="Frame ${i + 1} of the burst" loading="lazy" width="${animated.width}" height="${animated.height}">`).join("")}</div><figcaption>${animated.frames.length} frames ${FRAME_INTERVAL_MS} ms apart: shapes fade in and out, so one frame alone hides some.</figcaption></figure>`,
    },
    {
      title: "Label",
      text: "The challenge region is cropped from the screenshot at model resolution (regions under 300 px are doubled), and every target is outlined and tagged with its id: t1…t9 for tiles, m1… for regions that moved between frames, and names like submit or refresh for buttons. The model answers in those ids instead of coordinates wherever it can, which removes a whole class of near-misses.",
      source: "src/page/image.ts",
      artefact: `<figure><img src="${animated.labeled}" alt="The labeled frame the model receives, targets tagged with their ids" loading="lazy" width="${animated.width}" height="${animated.height}"><figcaption>What the model sees.</figcaption></figure>`,
    },
    {
      title: "Ask the model",
      text: "Any vision model through the AI SDK gets the instruction, the labeled frame and the raw burst, the regions that moved, the widget's errors and the last rounds. It must answer in a fixed schema: a short reasoning and a list of actions (click a target, clickPoint at image pixels, drag, type). A provider that fails hands over to the next configured model.",
      source: "src/core/prompt.ts",
      artefact: `<figure><pre class="json">${esc(JSON.stringify({ reasoning: animated.answer?.reasoning, actions: animated.answer?.actions.map(actionText) }, null, 1))}</pre><figcaption>${esc(animated.answer?.model ?? "")}'s answer to it.</figcaption></figure>`,
    },
    {
      title: "Act like a human",
      text: "Actions become trusted CDP mouse and key events, never synthetic DOM events. The pointer approaches on an eased path with jitter, pauses, presses and releases a few pixels off-centre; drags follow a minimum-jerk profile that never moves backwards, overshoots and settles. Image pixels map back to page pixels through the same scale the screenshot used.",
      source: "src/core/mouse.ts",
      artefact: `<figure><svg class="track" viewBox="0 0 320 160" role="img" aria-label="A click track planned by clickSteps: ${track.length} pointer events"><rect x="52" y="62" width="36" height="36" rx="6" class="widget"/><text x="102" y="85" class="label">I'm not a robot</text><polyline points="${pts}" class="path"/>${track.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.8" class="dot"/>`).join("")}<circle cx="${pressed[0]}" cy="${pressed[1]}" r="5" class="press"/></svg><figcaption>A real click track from <code>clickSteps</code>: ${track.length} events over ${data.tracks.checkbox.duration} ms.</figcaption></figure>`,
    },
    {
      title: "Read the verdict",
      text: "After acting, the widget itself says how it went: its solved signal, a response token appearing in the page (reCAPTCHA, hCaptcha, Turnstile count as solved only then), or an error such as “Please try again”. The state is published on the page as <code>data-captcha-state</code> so the agent driving the browser knows when to continue.",
      source: "src/page/index.ts",
      artefact: `<figure><div class="verdicts"><div><span class="badge good">accepted</span><code>${esc(animated.id)}</code><small>no error after the round</small></div><div><span class="badge bad">refused</span><code>${esc(refused.id)}</code><small>“${esc(refused.errorsAfter.join(" · "))}”</small></div></div><figcaption>The widget's verdicts, as recorded in the fixtures.</figcaption></figure>`,
    },
    {
      title: "Retry or reload",
      text: "A refusal goes back to the model with the earlier rounds, so it can correct itself. Two refusals in a row on one puzzle and the engine asks the widget for a new one (its reload button) with a fresh history. Every wait and model call ends at the session deadline; a failed session reads <code>failed</code> with a reason and, with reports on, files a GitHub issue carrying the rounds as replayable fixtures.",
      source: "src/core/engine.ts",
      artefact: `<figure><ol class="ladder"><li><b>Wrong answer</b><span>error + history → model</span></li><li><b>Two in a row</b><span>reload → new puzzle</span></li><li><b>Model call fails</b><span>next fallback model</span></li><li><b>Out of time</b><span>failed → issue + fixtures</span></li></ol><figcaption>How the engine recovers, step by step.</figcaption></figure>`,
    },
  ];
}

function stepper(data: ExplainerData): string {
  const all = steps(data);
  return `<div class="card stepper" data-stepper>
<div class="steps" role="tablist" aria-label="Solve loop">${all
    .map((s, i) => `<button role="tab" id="step-tab-${i}" aria-controls="step-${i}" aria-selected="${i === 0}" tabindex="${i ? -1 : 0}"><span>${i + 1}</span>${esc(s.title)}</button>`)
    .join("")}</div>
${all
  .map(
    (s, i) => `<section role="tabpanel" id="step-${i}" aria-labelledby="step-tab-${i}" class="step"${i ? " hidden" : ""}>
<div class="step-text"><h3>${i + 1}. ${esc(s.title)}</h3><p>${s.text}</p><p class="src">In ${code(s.source)}</p>
<div class="step-nav"><button class="btn" data-step="-1"${i ? "" : " disabled"}>← Back</button><button class="btn primary" data-step="1"${i === all.length - 1 ? " disabled" : ""}>Next step →</button></div></div>
<div class="step-art">${s.artefact}</div>
</section>`,
  )
  .join("\n")}
</div>`;
}

function coverageGrid(data: ExplainerData): string {
  return `<ul class="providers">${data.coverage
    .map((c) => {
      const tone = c.verified === c.adapters.length ? "good" : c.verified ? "mid" : "none";
      return `<li><div class="head"><b>${esc(c.name)}</b><span class="badge ${tone}" title="Challenges verified against the real widget">${c.verified}/${c.adapters.length} verified</span></div><span class="ways">${c.methods.map(esc).join(" · ")}</span></li>`;
    })
    .join("")}</ul>`;
}

const SECTIONS = [
  ["loop", "The solve loop"],
  ["rounds", "Vision model rounds"],
  ["slide", "Slide puzzles"],
  ["shift", "Shifted grid"],
  ["count", "Counting"],
  ["checks", "Checks without a model"],
  ["coverage", "Coverage"],
] as const;

export function renderExplainer(data: ExplainerData): string {
  const modelRounds = data.rounds.length;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>How it works · LLM Captcha Solver</title>
<meta name="description" content="How an LLM captcha solver gets through reCAPTCHA, hCaptcha, slide puzzles and more: the solve loop, what the vision model sees, and the image analysis behind sliders and DogWAF, on real captured challenges.">
${socialMeta("how-it-works.html", "How it works · LLM Captcha Solver", "The solve loop, what the vision model sees, and the image analysis behind slide puzzles and DogWAF, on real captured challenges.")}
<style>
${THEME_CSS}
${read("style.css")}
</style>
</head>
<body>
${siteNav("how-it-works.html")}
<main>
<header class="hero">
<p class="eyebrow">How it works</p>
<h1>A vision model where judgement is needed, image analysis where pixels are.</h1>
<p class="lede">The solver is a Chrome extension and a CDP library sharing one engine. It finds a challenge in the page, waits until it holds still, shows a vision model a labeled screenshot, and carries out the answer with human-like pointer movements. Slide puzzles, shifted grids and counting are solved by image analysis instead, because they need pixel precision rather than understanding.</p>
<p class="lede">Everything below runs on <b>real challenges captured from live sites</b> and on the solver's own code, computed when this page was built.</p>
<p class="links"><a class="btn primary" href="${REPO_URL}#readme">README</a><a class="btn" href="${REPO_URL}/blob/main/AGENTS.md">AGENTS.md</a><a class="btn" href="index.html">Leaderboard</a></p>
</header>
<nav class="toc" aria-label="On this page">${SECTIONS.map(([id, label]) => `<a href="#${id}">${label}</a>`).join("")}</nav>

<section id="loop" aria-labelledby="loop-h">
<h2 id="loop-h">The solve loop</h2>
<p>Each round goes through the same seven steps, until the widget accepts or the session runs out of time. Shown here on real rounds from the fixtures.</p>
${stepper(data)}
</section>

<section id="rounds" aria-labelledby="rounds-h">
<h2 id="rounds-h">Vision model rounds</h2>
<p>${modelRounds} rounds captured from live widgets, exactly as the model got them: the raw frames, the labeled frame, the targets the scan found, the answer the model gave live, and the label a person (or the vendor's acceptance) gave. Rectangles and points are drawn in the model's image pixels.</p>
<div class="card explorer" data-rounds>
<div class="bar">
<div class="chips" role="group" aria-label="Provider" data-providers></div>
<label class="field">Challenge <select data-round-select></select></label>
</div>
<div class="split">
<div class="viewer">
<div class="stage" data-stage><img data-round-img alt=""><svg data-round-svg aria-hidden="true"></svg></div>
<div class="toolbar">
<label class="switch"><input type="checkbox" data-labeled> What the model sees</label>
<label class="switch"><input type="checkbox" data-show-answer checked> Answer</label>
<label class="switch"><input type="checkbox" data-show-expected checked> Expected</label>
</div>
<div class="scrub" data-scrub><button class="btn icon" data-play aria-label="Play the frames">▶</button><label class="field grow">Frame <input type="range" min="1" value="1" data-frame></label><output data-frame-out></output></div>
</div>
<div class="facts" data-round-facts aria-live="polite"></div>
</div>
</div>
</section>

<section id="slide" aria-labelledby="slide-h">
<h2 id="slide-h">Slide puzzles by image analysis</h2>
<p>A slide puzzle must land within a few pixels, so no model is asked. ${code("src/core/puzzle.ts")} scores every offset to the right of the piece: how much the pixels just inside the piece's outline differ from a ring just outside it, darker or lighter. At the gap that contrast peaks. Drag the piece, or let it solve.</p>
<div class="card" data-slider>
<div class="bar"><label class="field">Puzzle <select data-slider-select></select></label></div>
<div class="split">
<div class="viewer">
<div class="puzzle" data-puzzle><img data-bg alt="Puzzle background with the gap"><img data-piece alt="Puzzle piece" class="piece"></div>
<label class="field range">Offset <input type="range" min="0" value="0" data-offset><output data-offset-out></output></label>
<div class="toolbar"><button class="btn primary" data-solve>Solve</button><button class="btn" data-reset>Reset</button></div>
</div>
<div class="facts">
<svg class="chart" data-chart viewBox="0 0 400 180" role="img" aria-label="Contrast score at every offset"></svg>
<dl class="stats" data-slider-stats aria-live="polite"></dl>
<p class="note" data-slider-notes></p>
</div>
</div>
</div>
</section>

<section id="shift" aria-labelledby="shift-h">
<h2 id="shift-h">DogWAF's shifted grid</h2>
<p>DogWAF asks for “the square with the dog's nose” in a picture that is a clean reference image rolled by whole squares of a 10 × 10 grid, warped and noised. The model finds the nose in the clean reference; ${code("src/core/shift.ts")} finds the roll by correlating the challenge with all 100 rolls of the reference. Hover or focus a cell to un-roll the challenge by it.</p>
<div class="card" data-shift>
<div class="bar"><label class="field">Challenge <select data-shift-select></select></label></div>
<div class="split three">
<figure><img data-ref alt="Reference image" class="pixel"><figcaption>Reference</figcaption></figure>
<figure><img data-ch alt="Challenge image: the reference rolled and noised" class="pixel"><figcaption>Challenge</figcaption></figure>
<figure><canvas data-unroll class="pixel" role="img" aria-label="The challenge un-rolled by the selected roll"></canvas><figcaption data-unroll-caption>Un-rolled</figcaption></figure>
</div>
<div class="split">
<div><div class="heat" data-heat role="grid" aria-readonly="true" aria-label="Correlation of every roll; rows are dy, columns dx"></div><p class="legend"><span class="sw best"></span> best roll <span class="sw expected"></span> the server's roll</p></div>
<div class="facts"><dl class="stats" data-shift-stats aria-live="polite"></dl><label class="switch"><input type="checkbox" data-blend checked> Blend over the reference</label><p class="note" data-shift-notes></p></div>
</div>
</div>
</section>

<section id="count" aria-labelledby="count-h">
<h2 id="count-h">DogWAF counting</h2>
<p>The compat page shows five images of noise with copies of one small picture pasted over it, and asks how many. ${code("src/core/stamps.ts")} first learns the picture from the columns that recur across the images, then counts by peeling: the copy pasted last fits exactly; once found, its pixels stop counting, which uncovers the copies under it for the next pass.</p>
<div class="card" data-count>
<div class="bar"><label class="field">Challenge <select data-count-select></select></label>
<div class="passes"><button class="btn" data-pass="-1" aria-label="Previous pass">←</button><output data-pass-out aria-live="polite"></output><button class="btn" data-pass="1" aria-label="Next pass">→</button></div></div>
<div class="count-layout">
<figure class="stamp"><canvas data-stamp class="pixel" role="img" aria-label="The learned picture, enlarged"></canvas><figcaption data-stamp-caption>Learned picture</figcaption></figure>
<div class="images" data-images></div>
</div>
<p class="note" data-count-notes></p>
</div>
</section>

<section id="checks" aria-labelledby="checks-h">
<h2 id="checks-h">Checks without a model</h2>
<p>Many challenges need no answer at all, only a human-looking gesture. These pointer tracks are planned by ${code("src/core/mouse.ts")} (sampled with a fixed seed) exactly as the engine sends them through CDP; a filled dot is the button held down.</p>
<div class="cards" data-checks>
<article class="card check" data-track="checkbox"><canvas width="320" height="160" role="img" aria-label="Pointer track of a checkbox click"></canvas><div><h3>Checkbox</h3><p>reCAPTCHA, hCaptcha, Turnstile: an eased approach, a short pause, a press a few pixels off-centre. Clicks are spaced so the vendor's verdict can arrive.</p><button class="btn" data-replay>Replay</button></div></article>
<article class="card check" data-track="hold"><canvas width="320" height="160" role="img" aria-label="Pointer track of a press and hold"></canvas><div><h3>Press &amp; Hold</h3><p>HUMAN/PerimeterX: wait until the widget arms, press, and keep the button down while the hand rests, moving ±3 px, until the fill completes.</p><button class="btn" data-replay>Replay</button></div></article>
<article class="card check" data-track="pow"><canvas width="320" height="160" role="img" aria-label="Pointer track that starts a proof-of-work check"></canvas><div><h3>Proof of work</h3><p>Friendly Captcha, ALTCHA, mCaptcha: one click to start, then the browser computes. Anubis and Cloudflare's “Just a moment…” need no pointer at all: the engine waits.</p><button class="btn" data-replay>Replay</button></div></article>
<article class="card check" data-track="slide"><canvas width="320" height="160" role="img" aria-label="Pointer track of a slide to the end"></canvas><div><h3>Slide to end</h3><p>Aliyun, DataDome, GNAME: press the handle and drag a few pixels past the rail's end on a minimum-jerk track that never moves back until it overshoots by a few px, then settles and releases.</p><button class="btn" data-replay>Replay</button></div></article>
</div>
</section>

<section id="coverage" aria-labelledby="coverage-h">
<h2 id="coverage-h">Coverage</h2>
<p>Every provider the solver recognizes, how its challenges are solved, and how many were verified against the real widget by the live tests. Per challenge and per model in the <a href="index.html#coverage">leaderboard</a>.</p>
${coverageGrid(data)}
</section>
</main>
<script type="application/json" id="data">${embed(data)}</script>
<script>
${read("client.js")}
</script>
</body>
</html>
`;
}
