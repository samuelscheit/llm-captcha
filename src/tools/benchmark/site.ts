/**
 * The leaderboard as a static page (GitHub Pages) and as an SVG chart (README). Pure renderers
 * over the rows of `leaderboard()`.
 */
import { categoryOf, count, usd, type Cell, type Row } from "./benchmark";
import { verificationLabel, type CoverageRow } from "./coverage";
import type { StoredFixture } from "../fixtures";

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const REPO_URL = "https://github.com/samuelscheit/llm-captcha";
/** The site's address, GitHub Pages of REPO_URL: link previews need absolute URLs. */
export const SITE_URL = (([owner, repo]) => `https://${owner}.github.io/${repo}/`)(new URL(REPO_URL).pathname.slice(1).split("/"));

/** Link-preview tags (Open Graph, X) for a page, with the social banner publish.ts copies to social.png. */
export const socialMeta = (page: string, title: string, description: string) => `<meta property="og:type" content="website">
<meta property="og:site_name" content="LLM Captcha Solver">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${SITE_URL}${page}">
<meta property="og:image" content="${SITE_URL}social.png">
<meta property="og:image:width" content="1280">
<meta property="og:image:height" content="640">
<meta property="og:image:alt" content="LLM Captcha Solver: a labeled reCAPTCHA, a slide puzzle's gap and DogWAF's roll heatmap">
<meta name="twitter:card" content="summary_large_image">`;

/** Colours, type and the top bar every page of the site shares. */
export const THEME_CSS = `:root{color-scheme:light dark;--bg:#f6f6f4;--surface:#fff;--text:#1b1b1a;--muted:#6b6a66;--line:#e3e2de;--good:#1a7f4b;--mid:#b7791f;--bad:#c53030;--good-bg:#e7f4ec;--mid-bg:#fbf1dc;--bad-bg:#fbe7e7}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--surface:#1f1f1e;--text:#ecebe7;--muted:#9b9a95;--line:#33332f;--good:#5cc98a;--mid:#e9b45a;--bad:#ff8a80;--good-bg:#173323;--mid-bg:#3a2e15;--bad-bg:#3d1c1a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,sans-serif}
a{color:inherit}
.topnav{border-bottom:1px solid var(--line);background:var(--surface)}
.topnav div{max-width:1040px;margin:0 auto;padding:0 20px;display:flex;gap:4px;align-items:center;height:52px;overflow-x:auto}
.topnav b{margin-right:auto;font-size:15px;white-space:nowrap}
.topnav a{text-decoration:none;color:var(--muted);font-size:14px;padding:6px 10px;border-radius:8px;white-space:nowrap}
.topnav a:hover{color:var(--text);background:var(--bg)}.topnav a[aria-current]{color:var(--text);font-weight:600;background:var(--bg)}`;

/** The site's top bar; `current` is the page it is on. */
export const siteNav = (current: "index.html" | "how-it-works.html") =>
  `<nav class="topnav" aria-label="Site"><div><b>LLM Captcha Solver</b>${[
    ["index.html", "Leaderboard"],
    ["how-it-works.html", "How it works"],
    [REPO_URL, "GitHub"],
  ]
    .map(([href, label]) => `<a href="${href}"${href === current ? ' aria-current="page"' : ""}>${label}</a>`)
    .join("")}</div></nav>`;
const rate = (c: Cell | undefined) => (c && c.total ? c.passed / c.total : undefined);
const pct = (c: Cell | undefined) => (rate(c) === undefined ? "–" : `${Math.round(rate(c)! * 100)}%`);

/** Green for solved most of the time, amber for sometimes, red for rarely. */
const tone = (r: number | undefined) => (r === undefined ? "none" : r >= 0.8 ? "good" : r >= 0.5 ? "mid" : "bad");

function categories(fixtures: StoredFixture[]) {
  const names = [...new Set(fixtures.map(categoryOf))].sort();
  return names.map((name) => ({ name, count: fixtures.filter((f) => categoryOf(f) === name).length }));
}

const updatedOf = (rows: Row[]) => rows.map((r) => r.measuredAt).sort().at(-1)?.slice(0, 10) ?? "never";

/** README chart: one row per model, a bar for the overall pass rate, cost per solve, then each category. */
export function renderSvg(rows: Row[], fixtures: StoredFixture[]): string {
  const cats = categories(fixtures);
  const nameW = 200;
  const barW = 220;
  const catW = 120;
  const costW = 110;
  const rowH = 34;
  /** Baseline of the first row; title, subtitle and column heads sit above it. */
  const top = 106;
  const costX = nameW + barW + 70;
  const catX = costX + costW;
  const width = catX + cats.length * catW + 24;
  const height = top - 22 + Math.max(rows.length, 1) * rowH + 12;
  const color = { good: "#1a7f4b", mid: "#b7791f", bad: "#c53030", none: "#8a8a85" };
  const body = rows.map((r, i) => {
    const y = top + i * rowH;
    const overall = rate(r.overall) ?? 0;
    return [
      i % 2 ? "" : `<rect x="0" y="${y - 22}" width="${width}" height="${rowH}" fill="#f6f6f4"/>`,
      `<text x="16" y="${y}" class="model">${esc(r.model)}</text>`,
      `<rect x="${nameW}" y="${y - 13}" width="${barW}" height="14" rx="7" fill="#e6e5e1"/>`,
      `<rect x="${nameW}" y="${y - 13}" width="${Math.max(barW * overall, 14)}" height="14" rx="7" fill="${color[tone(overall)]}"/>`,
      `<text x="${nameW + barW + 10}" y="${y}" class="value">${pct(r.overall)}</text>`,
      `<text x="${costX + costW / 2}" y="${y}" text-anchor="middle" class="cell">${usd(r.cost?.perSolve)}</text>`,
      ...cats.map((c, j) => {
        const cell = r.categories[c.name];
        return `<text x="${catX + j * catW + catW / 2}" y="${y}" text-anchor="middle" class="cell" fill="${color[tone(rate(cell))]}">${pct(cell)}</text>`;
      }),
    ].join("");
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Captcha solving leaderboard">
<style>
text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;fill:#1b1b1a}
.title{font-size:16px;font-weight:700}.sub{font-size:11px;fill:#6b6a66}.head{font-size:11px;font-weight:600;fill:#6b6a66}
.model{font-size:13px;font-weight:600}.value{font-size:13px;font-weight:700}.cell{font-size:13px;font-weight:600}
</style>
<rect width="${width}" height="${height}" rx="10" fill="#ffffff" stroke="#e3e2de"/>
<text x="16" y="28" class="title">Captcha solving by model</text>
<text x="16" y="47" class="sub">${esc(`${fixtures.length} real challenges, pass rate over all runs, cost at API list price · updated ${updatedOf(rows)}`)}</text>
<text x="16" y="74" class="head">MODEL</text>
<text x="${nameW}" y="74" class="head">OVERALL</text>
<text x="${costX + costW / 2}" y="74" text-anchor="middle" class="head">COST / SOLVE</text>
${cats.map((c, j) => `<text x="${catX + j * catW + catW / 2}" y="74" text-anchor="middle" class="head">${esc(`${c.name} (${c.count})`)}</text>`).join("\n")}
${body.join("\n") || `<text x="16" y="${top}" class="sub">No results yet.</text>`}
</svg>
`;
}

/** The GitHub Pages leaderboard: models per category, coverage per provider, models that cannot take part. */
export function renderSite(rows: Row[], fixtures: StoredFixture[], solverHash: string, unsupported: Record<string, string>, covered: CoverageRow[] = []): string {
  const cats = categories(fixtures);
  const cell = (c: Cell | undefined) =>
    `<td class="${tone(rate(c))}">${c ? `<b>${pct(c)}</b><small>${c.passed}/${c.total}</small>` : "–"}</td>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Captcha solving leaderboard</title>
<meta name="description" content="Which vision models solve real reCAPTCHA, hCaptcha and other challenges, measured on labeled fixtures.">
${socialMeta("", "AI model captcha leaderboard · LLM Captcha Solver", "Which vision models solve real reCAPTCHA, hCaptcha and other challenges, measured on labeled fixtures.")}
<style>
${THEME_CSS}
main{max-width:1040px;margin:0 auto;padding:48px 20px 72px}
h1{font-size:28px;letter-spacing:-.02em;margin:0 0 8px}p{color:var(--muted);margin:0 0 12px;max-width:720px}
.meta{font-size:13px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;margin-top:28px;overflow-x:auto}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
th,td{padding:12px 14px;text-align:left;border-bottom:1px solid var(--line);white-space:nowrap}
th{font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
th small,td small{display:block;font-size:12px;font-weight:400;color:var(--muted);text-transform:none;letter-spacing:0}
tr:last-child td{border-bottom:0}td.rank{color:var(--muted);width:1%}td.model{font-weight:600}
td.good b{color:var(--good)}td.mid b{color:var(--mid)}td.bad b{color:var(--bad)}
td.overall{background:var(--good-bg)}td.overall.mid{background:var(--mid-bg)}td.overall.bad{background:var(--bad-bg)}
h2{font-size:17px;margin:40px 0 8px}ul{color:var(--muted);padding-left:20px}code{font-size:13px}
</style>
</head>
<body>
${siteNav("index.html")}
<main>
<h1>Captcha solving leaderboard</h1>
<p>How often each vision model solves real reCAPTCHA, hCaptcha and other challenges. Every challenge is a fixture captured from a live page and labeled by hand, and is replayed exactly as the solver asks live: same screenshots, target labels, motion analysis and prompt. A run passes when its answer equals the labeled one; every run counts.</p>
<p>Most labels are answers the vendor itself accepted live, given by the model that captured them (claude-opus-5-5): another equally valid answer (a different click order, a point off the item's centre) can count as a miss. The rest were labeled by hand from the screenshots.</p>
<p class="meta">${fixtures.length} fixtures · updated ${updatedOf(rows)} · solver <code>${esc(solverHash)}</code> · <a href="how-it-works.html">How the solver works</a></p>
<div class="card">
<table>
<thead><tr><th></th><th>Model</th><th>Overall</th><th>Cost / solve<small>list price</small></th>${cats.map((c) => `<th>${esc(c.name)}<small>${c.count} fixtures</small></th>`).join("")}<th>Median time</th><th>Tokens<small>in / out per run</small></th><th>Cost / run</th></tr></thead>
<tbody>
${rows
  .map(
    (r, i) =>
      `<tr><td class="rank">${i + 1}</td><td class="model">${esc(r.model)}</td>${cell(r.overall).replace('<td class="', '<td class="overall ')}<td><b>${usd(r.cost?.perSolve)}</b></td>${cats.map((c) => cell(r.categories[c.name])).join("")}<td>${(r.medianMs / 1000).toFixed(1)}s</td><td>${r.tokens ? `${count(r.tokens.input)} / ${count(r.tokens.output)}` : "–"}</td><td>${usd(r.cost?.perRun)}</td></tr>`,
  )
  .join("\n") || `<tr><td colspan="${cats.length + 7}">No results yet.</td></tr>`}
</tbody>
</table>
</div>
${
  covered.length
    ? `<h2 id="coverage">Coverage</h2>
<p>Every challenge the solver recognizes, how it gets through it, and when that was last verified against the real widget.</p>
<div class="card"><table>
<thead><tr><th>Provider</th><th>Challenge</th><th>Solved by</th><th>Verified on the real widget</th></tr></thead>
<tbody>
${covered
  .map((c) => {
    const label = verificationLabel(c.verification);
    const cls = label.startsWith("✅") ? "good" : label.startsWith("❌") ? "bad" : "none";
    return `<tr><td>${esc(c.provider)}</td><td><code>${esc(c.adapter)}</code></td><td>${esc(c.method)}</td><td class="${cls}"><b>${esc(label)}</b></td></tr>`;
  })
  .join("\n")}
</tbody></table></div>`
    : ""
}
<h2>Categories</h2>
<ul>
<li><b>select</b>: pick image tiles (reCAPTCHA grids, including the dynamic ones whose tiles are replaced after each click).</li>
<li><b>point</b>: click positions in a canvas (hCaptcha shape puzzles, which animate: the model gets several frames and the regions that moved).</li>
<li><b>text</b>: read distorted characters.</li>
</ul>
${
  Object.keys(unsupported).length
    ? `<h2>Not on the board</h2><p>Offered by the gateway, but refused the request (for example no image input):</p><ul>${Object.entries(unsupported)
        .sort()
        .map(([m, why]) => `<li><b>${esc(m)}</b>: ${esc(why.slice(0, 140))}</li>`)
        .join("")}</ul>`
    : ""
}
<h2>Method</h2>
<p>Models are measured once per version of the fixtures and of the solver code that shapes their input; new models offered by the gateway are measured weekly. Provider outages and rate limits are retried later, never counted as failures.</p>
<p>Tokens are the median per run as the provider reported them (output includes reasoning). Cost is at the provider's API list price (<a href="https://github.com/pydantic/genai-prices">genai-prices</a>), not what a gateway or plan bills, with all input uncached as on a live challenge. Cost per solve is everything spent ÷ runs passed, so failed attempts count against it.</p>
</main>
</body>
</html>
`;
}
