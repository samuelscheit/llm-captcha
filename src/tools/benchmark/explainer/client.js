// The "How it works" page's interactions. Plain JS, no dependencies: everything it shows comes from
// the JSON the build embedded (#data), computed from the real fixtures and solver code.
(() => {
  "use strict";
  const DATA = JSON.parse(document.getElementById("data").textContent);
  const REPO = "https://github.com/samuelscheit/llm-captcha";
  const SVG = "http://www.w3.org/2000/svg";
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const $ = (root, sel) => root.querySelector(sel);
  const $$ = (root, sel) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const svgEl = (tag, attrs = {}, text) => {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const shortName = (id) => {
    const name = id.split("/")[1];
    const stamp = name.match(/^(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d)-\d+Z-(.+)$/);
    const tail = name.match(/^(.+)-(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d)-\d+Z$/);
    if (stamp) return `${stamp[5]} · ${stamp[2]}:${stamp[3]}:${stamp[4]}`;
    if (tail) return `${tail[1]} · ${tail[3]}:${tail[4]}:${tail[5]}`;
    return name;
  };
  const fixtureLink = (id) => `<a href="${REPO}/tree/main/fixtures/${id}"><code>fixtures/${esc(id)}</code></a>`;
  const fill = (select, items, label) => {
    select.innerHTML = items.map((item, i) => `<option value="${i}">${esc(label(item))}</option>`).join("");
  };

  // ------------------------------------------------------------ stepper
  for (const root of $$(document, "[data-stepper]")) {
    const tabs = $$(root, "[role=tab]");
    const show = (i, focus) => {
      tabs.forEach((tab, j) => {
        tab.setAttribute("aria-selected", String(i === j));
        tab.tabIndex = i === j ? 0 : -1;
        document.getElementById(tab.getAttribute("aria-controls")).hidden = i !== j;
      });
      // Bring the tab into view in its strip only: scrollIntoView would move the page too.
      const strip = tabs[i].parentElement;
      const { offsetLeft: left, offsetWidth: width } = tabs[i];
      if (left < strip.scrollLeft || left + width > strip.scrollLeft + strip.clientWidth) strip.scrollTo({ left: left - 16, behavior: reduced.matches ? "auto" : "smooth" });
      if (focus) tabs[i].focus();
    };
    const current = () => tabs.findIndex((t) => t.getAttribute("aria-selected") === "true");
    tabs.forEach((tab, i) => {
      tab.addEventListener("click", () => show(i));
      tab.addEventListener("keydown", (e) => {
        const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
        if (to === undefined) return;
        e.preventDefault();
        show((to + tabs.length) % tabs.length, true);
      });
    });
    root.addEventListener("click", (e) => {
      const button = e.target.closest("[data-step]");
      if (button) show(Math.min(tabs.length - 1, Math.max(0, current() + Number(button.dataset.step))), true);
    });
  }

  // ------------------------------------------------------------ vision model rounds
  {
    const root = $(document, "[data-rounds]");
    const providers = [...new Set(DATA.rounds.map((r) => r.provider))];
    const state = { provider: providers[0], round: null, frame: 0, labeled: false, answer: true, expected: true, timer: 0 };
    const select = $(root, "[data-round-select]");
    const img = $(root, "[data-round-img]");
    const svg = $(root, "[data-round-svg]");
    const facts = $(root, "[data-round-facts]");
    const frameInput = $(root, "[data-frame]");
    const frameOut = $(root, "[data-frame-out]");
    const play = $(root, "[data-play]");
    const chips = $(root, "[data-providers]");
    const roundsOf = (p) => DATA.rounds.filter((r) => r.provider === p);

    chips.innerHTML = providers.map((p) => `<button type="button" data-p="${p}" aria-pressed="false">${esc(DATA.providers[p] ?? p)}<small>${roundsOf(p).length}</small></button>`).join("");
    chips.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (b) pickProvider(b.dataset.p);
    });

    const stop = () => {
      clearInterval(state.timer);
      state.timer = 0;
      play.textContent = "▶";
      play.setAttribute("aria-label", "Play the frames");
    };
    const pickProvider = (p) => {
      state.provider = p;
      $$(chips, "button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.p === p)));
      fill(select, roundsOf(p), (r) => `${shortName(r.id)}${r.verdict && !r.verdict.pass ? "  ✗" : ""}`);
      pickRound(0);
    };
    const pickRound = (i) => {
      stop();
      state.round = roundsOf(state.provider)[i];
      select.value = String(i);
      state.frame = state.round.frames.length - 1;
      // Preloaded, so playing the burst does not flicker.
      for (const src of [...state.round.frames, state.round.labeled].filter(Boolean)) new Image().src = src;
      renderFacts();
      render();
    };
    select.addEventListener("change", () => pickRound(Number(select.value)));
    const toggle = (sel, key) => $(root, sel).addEventListener("change", (e) => ((state[key] = e.target.checked), key === "labeled" && stop(), render()));
    toggle("[data-labeled]", "labeled");
    toggle("[data-show-answer]", "answer");
    toggle("[data-show-expected]", "expected");
    frameInput.addEventListener("input", () => (stop(), (state.frame = Number(frameInput.value) - 1), render()));
    play.addEventListener("click", () => {
      if (state.timer) return stop();
      state.labeled = false;
      $(root, "[data-labeled]").checked = false;
      play.textContent = "❚❚";
      play.setAttribute("aria-label", "Pause");
      state.timer = setInterval(() => ((state.frame = (state.frame + 1) % state.round.frames.length), render()), 300);
    });

    const actionText = (a) =>
      a.kind === "click" ? `click ${a.target}` : a.kind === "type" ? `type “${a.text}”` : a.kind === "clickPoint" ? `point ${Math.round(a.x)},${Math.round(a.y)}` : a.kind === "drag" ? `drag ${Math.round(a.x)},${Math.round(a.y)}→${Math.round(a.toX)},${Math.round(a.toY)}` : "wait";

    function overlay(r, labeled) {
      svg.replaceChildren();
      svg.setAttribute("viewBox", `0 0 ${r.width} ${r.height}`);
      // Targets and the answer belong to the last frame, the one scanned and answered.
      if (!labeled && state.frame !== r.frames.length - 1) return;
      svg.setAttribute("preserveAspectRatio", "none");
      const k = r.width / 480; // badge size: readable at any screenshot size
      const box = (id) => r.targets.find((t) => t.id === id)?.box;
      const defs = svgEl("defs");
      const marker = svgEl("marker", { id: "arrow", viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: "auto-start-reverse" });
      marker.append(svgEl("path", { d: "M0,0 L10,5 L0,10 z", fill: css("--answer") }));
      defs.append(marker);
      svg.append(defs);
      if (!labeled) for (const t of r.targets) if (t.box) svg.append(svgEl("rect", { x: t.box.x, y: t.box.y, width: t.box.w, height: t.box.h, class: "ov-target", "vector-effect": "non-scaling-stroke" }));
      if (state.expected) {
        for (const id of r.expected.clicks ?? []) {
          const b = box(id);
          if (b) svg.append(svgEl("rect", { x: b.x + 3, y: b.y + 3, width: b.w - 6, height: b.h - 6, rx: 4, class: "ov-expected", "vector-effect": "non-scaling-stroke" }));
        }
        for (const p of r.expected.points ?? []) svg.append(svgEl("circle", { cx: p.x, cy: p.y, r: p.r, class: "ov-expected", "vector-effect": "non-scaling-stroke" }));
      }
      if (state.answer && r.answer) {
        const badge = (x, y, n) => {
          svg.append(svgEl("circle", { cx: x, cy: y, r: 11 * k, class: "ov-numbg" }));
          svg.append(svgEl("text", { x, y, class: "ov-num", style: `font-size:${13 * k}px` }, n));
        };
        r.answer.actions.forEach((a, i) => {
          const n = i + 1;
          if (a.kind === "click" || a.kind === "type") {
            const b = box(a.target);
            if (!b) return;
            svg.append(svgEl("rect", { x: b.x, y: b.y, width: b.w, height: b.h, class: "ov-answer", "vector-effect": "non-scaling-stroke" }));
            badge(b.x + b.w - 14 * k, b.y + 14 * k, n);
          } else if (a.kind === "clickPoint") {
            svg.append(svgEl("circle", { cx: a.x, cy: a.y, r: 6 * k, class: "ov-point", "vector-effect": "non-scaling-stroke" }));
            badge(a.x + 16 * k, a.y - 16 * k, n);
          } else if (a.kind === "drag") {
            svg.append(svgEl("line", { x1: a.x, y1: a.y, x2: a.toX, y2: a.toY, class: "ov-drag", "vector-effect": "non-scaling-stroke" }));
            badge(a.x, a.y, n);
          }
        });
      }
    }

    function render() {
      const r = state.round;
      const labeled = state.labeled && !!r.labeled;
      const last = state.frame === r.frames.length - 1;
      img.src = labeled ? r.labeled : r.frames[state.frame];
      img.width = r.width;
      img.height = r.height;
      img.alt = labeled ? `Labeled frame of ${r.id}: targets tagged with their ids, as the model received it` : `Frame ${state.frame + 1} of ${r.frames.length} of ${r.id}: ${r.instruction || "a text challenge"}`;
      const box = $(root, "[data-labeled]");
      box.disabled = !r.labeled;
      box.checked = labeled;
      $(root, "[data-scrub]").hidden = r.frames.length < 2;
      frameInput.max = String(r.frames.length);
      frameInput.value = String(state.frame + 1);
      frameInput.disabled = labeled;
      play.disabled = labeled;
      frameOut.textContent = `${state.frame + 1} / ${r.frames.length}${labeled || last ? "" : " · overlays on the last frame"}`;
      overlay(r, labeled);
    }

    function renderFacts() {
      const r = state.round;
      const answerIds = new Set((r.answer?.actions ?? []).map((a) => a.target).filter(Boolean));
      const expectedIds = new Set(r.expected.clicks ?? []);
      const verdict = r.verdict
        ? r.verdict.pass
          ? `<span class="badge good">matches the label</span>`
          : `<span class="badge bad">misses the label</span>`
        : `<span class="badge none">no answer recorded</span>`;
      const vendor = r.errorsAfter.length ? `<span class="badge bad">widget: “${esc(r.errorsAfter.join(" · "))}”</span>` : `<span class="badge good">widget: no error</span>`;
      const expectedItems = [...(r.expected.clicks ?? []).map((c) => `click ${c}`), ...(r.expected.points ?? []).map((p) => `point ${Math.round(p.x)},${Math.round(p.y)} ±${Math.round(p.r)}`), ...(r.expected.text !== undefined ? [`type “${r.expected.text}”`] : [])];
      facts.innerHTML = `
        <h3>Instruction</h3>
        <p class="instruction">${r.instruction ? esc(r.instruction.replace(/\s*\[[^\]]*\]\s*$/, "")) : "<em>None: read the characters and type them.</em>"}</p>
        <p class="legend"><span class="sw answer"></span> model's answer <span class="sw expected"></span> expected</p>
        <h3>Live answer · ${esc(r.answer?.model ?? "–")}</h3>
        <p>${verdict} ${vendor}</p>
        <ol class="answer-list">${(r.answer?.actions ?? []).map((a, i) => `<li>${i + 1}. ${esc(actionText(a))}</li>`).join("")}</ol>
        ${r.answer ? `<p class="reasoning">${esc(r.answer.reasoning)}</p>` : ""}
        ${r.verdict && !r.verdict.pass ? `<p class="note">${r.verdict.problems.map(esc).join("<br>")}</p>` : ""}
        <h3>Expected</h3>
        <ul class="answer-list expected">${expectedItems.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
        <h3>Targets the scan found · ${r.targets.length}</h3>
        <div class="targets">${r.targets.map((t) => `<button type="button" tabindex="-1" class="${[answerIds.has(t.id) && "picked", expectedIds.has(t.id) && "hit", !t.box && "off"].filter(Boolean).join(" ")}" title="${t.box ? `${Math.round(t.box.w)}×${Math.round(t.box.h)} at ${Math.round(t.box.x)},${Math.round(t.box.y)}` : "outside the screenshot"}">${esc(t.id)}</button>`).join("")}</div>
        ${r.lastEval ? `<h3>Latest eval · ${esc(r.lastEval.model)}</h3><p>${r.lastEval.pass ? `<span class="badge good">passed</span>` : `<span class="badge bad">failed</span> ${r.lastEval.problems.map(esc).join("; ")}`}</p>` : ""}
        <h3>Where it is from</h3>
        <dl class="stats"><dt>Adapter</dt><dd><code>${esc(r.adapter)}</code> (${esc(r.kind)})</dd><dt>Site</dt><dd>${esc(r.source)}</dd><dt>Image</dt><dd>${r.width}×${r.height} px${r.scale !== 1 ? `, ${r.scale}× the page` : ""}</dd><dt>Fixture</dt><dd>${fixtureLink(r.id)}</dd></dl>
        <p class="note">${esc(r.notes)}</p>`;
    }
    pickProvider(state.provider);
  }

  // ------------------------------------------------------------ slide puzzles
  {
    const root = $(document, "[data-slider]");
    const select = $(root, "[data-slider-select]");
    const bg = $(root, "[data-bg]");
    const piece = $(root, "[data-piece]");
    const range = $(root, "[data-offset]");
    const out = $(root, "[data-offset-out]");
    const chart = $(root, "[data-chart]");
    const stats = $(root, "[data-slider-stats]");
    let p;
    let offset = 0;
    let anim = 0;
    fill(select, DATA.sliders, (s) => `${DATA.providers[s.provider] ?? s.provider} · ${shortName(s.id)}`);
    const W = 400, H = 180, L = 34, R = 392, T = 14, B = 154;
    const xOf = (o) => L + ((o - p.scores[0][0]) / (p.scores.at(-1)[0] - p.scores[0][0])) * (R - L);
    let yOf;

    function drawChart() {
      chart.replaceChildren();
      const values = p.scores.map((s) => s[1]);
      const [min, max] = [Math.min(0, ...values), Math.max(...values)];
      yOf = (v) => B - ((v - min) / (max - min || 1)) * (B - T);
      const line = p.scores.map(([o, s]) => `${xOf(o).toFixed(1)},${yOf(s).toFixed(1)}`).join(" ");
      chart.append(svgEl("line", { x1: L, x2: R, y1: yOf(0), y2: yOf(0), class: "axis" }));
      chart.append(svgEl("polygon", { points: `${xOf(p.scores[0][0])},${yOf(0)} ${line} ${xOf(p.scores.at(-1)[0])},${yOf(0)}`, class: "area" }));
      chart.append(svgEl("polyline", { points: line, class: "line" }));
      chart.append(svgEl("line", { x1: xOf(p.expected), x2: xOf(p.expected), y1: T, y2: B, class: "expected" }));
      chart.append(svgEl("line", { x1: xOf(p.found), x2: xOf(p.found), y1: T, y2: B, class: "found" }));
      chart.append(svgEl("text", { x: L - 6, y: yOf(max) + 4, "text-anchor": "end" }, max.toFixed(2)));
      chart.append(svgEl("text", { x: L - 6, y: yOf(0) + 4, "text-anchor": "end" }, "0"));
      chart.append(svgEl("text", { x: L, y: H - 6 }, `offset ${p.scores[0][0]} px`));
      chart.append(svgEl("text", { x: R, y: H - 6, "text-anchor": "end" }, `${p.scores.at(-1)[0]} px`));
      const gapLabel = xOf(p.found) > (L + R) / 2 ? { x: xOf(p.found) - 6, "text-anchor": "end" } : { x: xOf(p.found) + 6 };
      chart.append(svgEl("text", { ...gapLabel, y: T + 10 }, `gap at ${p.found} px`));
      chart.append(svgEl("line", { x1: 0, x2: 0, y1: T, y2: B, class: "cursor", "data-cursor": "" }));
      chart.append(svgEl("circle", { r: 4, class: "knob", "data-knob": "" }));
    }

    const scoreAt = (o) => p.scores.find((s) => s[0] === o)?.[1];
    function place() {
      piece.style.left = `${((p.origin.x + offset) / p.bg.w) * 100}%`;
      range.value = String(Math.round(offset));
      const o = Math.round(offset);
      out.textContent = `${o} px`;
      const s = scoreAt(o);
      range.setAttribute("aria-valuetext", `${o} px${s === undefined ? "" : `, score ${s.toFixed(2)}`}${o === p.found ? ", the gap" : ""}`);
      const x = xOf(Math.min(Math.max(o, p.scores[0][0]), p.scores.at(-1)[0]));
      const cursor = $(chart, "[data-cursor]");
      cursor.setAttribute("x1", x);
      cursor.setAttribute("x2", x);
      const knob = $(chart, "[data-knob]");
      knob.setAttribute("cx", x);
      knob.setAttribute("cy", yOf(s ?? 0));
      const sure = p.margin >= DATA.constants.minMargin;
      const hit = Math.abs(p.found - p.expected) <= 2;
      stats.innerHTML = `<dt>Score here</dt><dd>${s === undefined ? "start: not scored" : s.toFixed(3)}</dd>
        <dt>Gap found</dt><dd>${p.found} px</dd>
        <dt>Accepted offset</dt><dd>${p.expected} px ${hit ? `<span class="badge good">match</span>` : `<span class="badge bad">off by ${p.found - p.expected}</span>`}</dd>
        <dt>Margin</dt><dd>${p.margin.toFixed(2)} ${sure ? `<span class="badge good">≥ ${DATA.constants.minMargin}: slide</span>` : `<span class="badge mid">&lt; ${DATA.constants.minMargin}: ask for a new puzzle</span>`}</dd>
        <dt>Images</dt><dd>${p.bg.w}×${p.bg.h} background, ${p.pc.w}×${p.pc.h} piece, from ${esc(p.source)}</dd>`;
    }
    function pick(i) {
      cancelAnimationFrame(anim);
      p = DATA.sliders[i];
      bg.src = p.background;
      bg.width = p.bg.w;
      bg.height = p.bg.h;
      piece.src = p.piece;
      piece.style.width = `${(p.pc.w / p.bg.w) * 100}%`;
      piece.style.top = `${(p.origin.y / p.bg.h) * 100}%`;
      range.max = String(p.scores.at(-1)[0]);
      $(root, "[data-slider-notes]").innerHTML = `${esc(p.notes)} ${fixtureLink(p.id)}`;
      offset = 0;
      drawChart();
      place();
    }
    function animateTo(target) {
      cancelAnimationFrame(anim);
      if (reduced.matches) return ((offset = target), place());
      const from = offset;
      const start = performance.now();
      const ms = 500 + Math.abs(target - from) * 2;
      const step = (now) => {
        const t = Math.min(1, (now - start) / ms);
        offset = from + (target - from) * (t * t * t * (10 - 15 * t + 6 * t * t)); // minimum jerk, as mouse.ts drags
        place();
        if (t < 1) anim = requestAnimationFrame(step);
      };
      anim = requestAnimationFrame(step);
    }
    select.addEventListener("change", () => pick(Number(select.value)));
    range.addEventListener("input", () => (cancelAnimationFrame(anim), (offset = Number(range.value)), place()));
    $(root, "[data-solve]").addEventListener("click", () => animateTo(p.found));
    $(root, "[data-reset]").addEventListener("click", () => animateTo(0));
    // Drag the piece itself.
    const puzzle = $(root, "[data-puzzle]");
    piece.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      cancelAnimationFrame(anim);
      piece.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startOffset = offset;
      const perPx = p.bg.w / puzzle.clientWidth;
      const move = (ev) => ((offset = Math.max(0, Math.min(Number(range.max), startOffset + (ev.clientX - startX) * perPx))), place());
      const up = () => {
        piece.removeEventListener("pointermove", move);
        for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) piece.removeEventListener(type, up);
      };
      piece.addEventListener("pointermove", move);
      for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) piece.addEventListener(type, up);
    });
    piece.style.cursor = "grab";
    piece.style.touchAction = "none";
    pick(0);
  }

  // ------------------------------------------------------------ shifted grid
  {
    const root = $(document, "[data-shift]");
    const select = $(root, "[data-shift-select]");
    const heat = $(root, "[data-heat]");
    const canvas = $(root, "[data-unroll]");
    const ctx = canvas.getContext("2d");
    const stats = $(root, "[data-shift-stats]");
    const blend = $(root, "[data-blend]");
    const refImg = $(root, "[data-ref]");
    const chImg = $(root, "[data-ch]");
    let s;
    let selected = { dx: 0, dy: 0 };
    let shown = selected;
    const loaded = (image) => (image.complete && image.naturalWidth ? Promise.resolve() : new Promise((r) => image.addEventListener("load", r, { once: true })));
    fill(select, DATA.shifts, (x) => shortName(x.id));
    // Viridis, low to high.
    const RAMP = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]];
    const ramp = (t) => {
      const f = Math.min(0.9999, Math.max(0, t)) * (RAMP.length - 1);
      const [a, b] = [RAMP[Math.floor(f)], RAMP[Math.floor(f) + 1]];
      const m = f - Math.floor(f);
      return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * m)).join(",")})`;
    };

    function draw() {
      const { dx, dy } = shown;
      const n = s.size;
      canvas.width = canvas.height = n;
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = 1;
      const sx = Math.round((dx * n) / s.grid);
      const sy = Math.round((dy * n) / s.grid);
      if (blend.checked) ctx.drawImage(refImg, 0, 0, n, n);
      ctx.globalAlpha = blend.checked ? 0.6 : 1;
      // The challenge's pixel (x + sx, y + sy) came from the reference's (x, y): draw it back, wrapping.
      for (const ox of [0, n]) for (const oy of [0, n]) ctx.drawImage(chImg, ox - sx, oy - sy, n, n);
      const score = s.scores[dy * s.grid + dx];
      $(root, "[data-unroll-caption]").textContent = `Un-rolled by (${dx}, ${dy}): ${score.toFixed(3)}`;
      stats.innerHTML = `<dt>Previewing</dt><dd>roll (${dx}, ${dy}) · correlation ${score.toFixed(3)}</dd>
        <dt>Best roll</dt><dd>(${s.found.dx}, ${s.found.dy}) · ${s.scores[s.found.dy * s.grid + s.found.dx].toFixed(3)}</dd>
        <dt>Server's roll</dt><dd>(${s.expected.dx}, ${s.expected.dy}) ${s.found.dx === s.expected.dx && s.found.dy === s.expected.dy ? `<span class="badge good">match</span>` : `<span class="badge bad">mismatch</span>`}</dd>
        <dt>Margin</dt><dd>${s.margin.toFixed(2)} over the runner-up ${s.margin >= DATA.constants.minShiftMargin ? `<span class="badge good">≥ ${DATA.constants.minShiftMargin}: click</span>` : `<span class="badge mid">guess: new challenge</span>`}</dd>`;
    }
    const preview = (cell) => ((shown = cell), loaded(chImg).then(() => loaded(refImg)).then(draw));
    function select_(cell, focus) {
      selected = cell;
      $$(heat, "button").forEach((b) => {
        const on = Number(b.dataset.dx) === cell.dx && Number(b.dataset.dy) === cell.dy;
        b.setAttribute("aria-selected", String(on));
        b.tabIndex = on ? 0 : -1;
        if (on && focus) b.focus();
      });
      preview(cell);
    }
    function pick(i) {
      s = DATA.shifts[i];
      refImg.src = s.reference;
      chImg.src = s.challenge;
      const [min, max] = [Math.min(...s.scores), Math.max(...s.scores)];
      heat.innerHTML = Array.from({ length: s.grid }, (_, dy) => `<div role="row">${Array.from({ length: s.grid }, (_, dx) => {
        const v = s.scores[dy * s.grid + dx];
        const cls = [dx === s.found.dx && dy === s.found.dy && "best", dx === s.expected.dx && dy === s.expected.dy && "expected"].filter(Boolean).join(" ");
        return `<button type="button" role="gridcell" data-dx="${dx}" data-dy="${dy}" class="${cls}" style="background:${ramp((v - min) / (max - min || 1))}" aria-label="Roll ${dx} right, ${dy} down: correlation ${v.toFixed(3)}" title="(${dx}, ${dy}) ${v.toFixed(3)}" tabindex="-1"></button>`;
      }).join("")}</div>`).join("");
      $(root, "[data-shift-notes]").innerHTML = `${esc(s.notes)} ${fixtureLink(s.id)}`;
      select_(s.found);
    }
    const cellOf = (b) => ({ dx: Number(b.dataset.dx), dy: Number(b.dataset.dy) });
    // Hover previews with a mouse only: a touch never leaves, so it would stick.
    heat.addEventListener("pointerover", (e) => e.pointerType === "mouse" && e.target.closest("button") && preview(cellOf(e.target.closest("button"))));
    heat.addEventListener("pointerleave", (e) => e.pointerType === "mouse" && preview(selected));
    heat.addEventListener("focusin", (e) => e.target.closest("button") && preview(cellOf(e.target.closest("button"))));
    heat.addEventListener("click", (e) => e.target.closest("button") && select_(cellOf(e.target.closest("button"))));
    heat.addEventListener("keydown", (e) => {
      const g = s.grid;
      const to = {
        ArrowRight: { dx: Math.min(g - 1, selected.dx + 1), dy: selected.dy },
        ArrowLeft: { dx: Math.max(0, selected.dx - 1), dy: selected.dy },
        ArrowDown: { dx: selected.dx, dy: Math.min(g - 1, selected.dy + 1) },
        ArrowUp: { dx: selected.dx, dy: Math.max(0, selected.dy - 1) },
        Home: { dx: 0, dy: selected.dy },
        End: { dx: g - 1, dy: selected.dy },
      }[e.key];
      if (!to) return;
      e.preventDefault();
      select_(to, true);
    });
    blend.addEventListener("change", draw);
    select.addEventListener("change", () => pick(Number(select.value)));
    pick(0);
  }

  // ------------------------------------------------------------ counting
  {
    const root = $(document, "[data-count]");
    const select = $(root, "[data-count-select]");
    const images = $(root, "[data-images]");
    const out = $(root, "[data-pass-out]");
    const COLORS = ["#ff453a", "#ffd60a", "#32d74b", "#0a84ff", "#bf5af2", "#ff9f0a", "#64d2ff"];
    let c;
    let pass = 0;
    fill(select, DATA.counts, (x) => `${shortName(x.id)}${x.counted ? "" : " · declined"}`);
    const maxPasses = () => Math.max(0, ...c.passes.map((p) => p.length));
    const outline = ({ x, tops }, size) => {
      let d = `M${x},${tops[0]}`;
      for (let i = 0; i < tops.length; i++) d += `H${x + i + 1}${i < tops.length - 1 ? `V${tops[i + 1]}` : ""}`;
      d += `V${tops.at(-1) + size}`;
      for (let i = tops.length - 1; i >= 0; i--) d += `H${x + i}${i > 0 ? `V${tops[i - 1] + size}` : ""}`;
      return `${d}Z`;
    };
    function drawStamp() {
      const fig = $(root, ".stamp");
      $(fig, ".empty")?.remove();
      const canvas = $(fig, "canvas");
      canvas.hidden = !c.stamp;
      if (!c.stamp) {
        canvas.insertAdjacentHTML("afterend", `<div class="empty">No picture recurs across the five images: image analysis declines and the model counts.</div>`);
        $(root, "[data-stamp-caption]").textContent = "Nothing learned";
        return;
      }
      const ctx = canvas.getContext("2d");
      canvas.width = c.stamp.length;
      canvas.height = c.stamp[0].length;
      const img = ctx.createImageData(canvas.width, canvas.height);
      c.stamp.forEach((column, x) => column.forEach((v, y) => img.data.set([v, v, v, 255], (y * canvas.width + x) * 4)));
      ctx.putImageData(img, 0, 0);
      $(root, "[data-stamp-caption]").textContent = `Learned picture, ${c.size}×${c.size} px; columns wobble down by up to ${c.wobble - 1} px`;
    }
    function render() {
      const max = maxPasses();
      out.textContent = !c.stamp ? "No passes" : pass === 0 ? `Before peeling` : `Pass ${pass} of ${max}`;
      $$(root, "[data-pass]").forEach((b) => (b.disabled = !c.stamp || (b.dataset.pass === "-1" ? pass === 0 : pass === max)));
      const { w, h } = c.imageSize;
      images.innerHTML = c.images
        .map((src, i) => {
          const passes = c.passes[i].slice(0, pass);
          const found = passes.flat().length;
          const done = pass === max;
          const expected = c.expected[i];
          const verdict = !c.stamp ? `<span>expected ${expected}</span>` : done ? (found === expected ? `<span class="badge good">${found} ✓</span>` : `<span class="badge bad">${found} of ${expected}</span>`) : `<span>${found} so far</span>`;
          const paths = passes.map((copies, k) => copies.map((p) => `<path d="${outline(p, c.size)}" class="copy${k === pass - 1 ? " new" : ""}" stroke="${COLORS[k % COLORS.length]}" vector-effect="non-scaling-stroke"/>`).join("")).join("");
          return `<figure><div class="frame"><img src="${src}" width="${w}" height="${h}" alt="Image ${i + 1}: noise with ${expected} copies of the picture"><svg viewBox="0 0 ${w} ${h}" aria-hidden="true">${paths}</svg></div><figcaption><span>Image ${i + 1}</span>${verdict}</figcaption></figure>`;
        })
        .join("");
      const right = c.expected.filter((n, i) => c.passes[i].flat().length === n).length;
      const summary = !c.stamp ? "" : right === c.expected.length ? `All ${right} images counted right. ` : `Counted ${right} of ${c.expected.length} images right; a miss is a copy painted over almost entirely by later ones, never one made up. `;
      $(root, "[data-count-notes]").innerHTML = `${summary}${esc(c.notes)} ${fixtureLink(c.id)}`;
    }
    function pick(i) {
      c = DATA.counts[i];
      pass = c.stamp ? 1 : 0;
      drawStamp();
      render();
    }
    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-pass]");
      if (!b) return;
      pass = Math.max(0, Math.min(maxPasses(), pass + Number(b.dataset.pass)));
      render();
    });
    select.addEventListener("change", () => pick(Number(select.value)));
    // Open on the one the analysis gets wrong: the page is honest about it.
    const missIndex = DATA.counts.findIndex((x) => x.counted && x.stamp && x.expected.some((n, i) => x.passes[i].flat().length !== n));
    select.value = String(Math.max(0, missIndex));
    pick(Math.max(0, missIndex));
  }

  // ------------------------------------------------------------ pointer tracks
  {
    const dpr = Math.min(2, devicePixelRatio || 1);
    function player(card) {
      const track = DATA.tracks[card.dataset.track];
      const kind = card.dataset.track;
      const canvas = $(card, "canvas");
      canvas.width = 320 * dpr;
      canvas.height = 160 * dpr;
      const ctx = canvas.getContext("2d");
      const pts = track.points;
      const pressAt = pts.find((p) => p[2])?.[3] ?? track.duration;
      const releaseAt = [...pts].reverse().find((p) => p[2])?.[3] ?? track.duration;
      let raf = 0;
      const rounded = (x, y, w, h, r) => (ctx.beginPath(), ctx.roundRect(x, y, w, h, r));
      function frame(t) {
        const c = { text: css("--text"), muted: css("--muted"), line: css("--line"), surface: css("--surface"), accent: css("--accent"), good: css("--good"), bad: css("--bad") };
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, 320, 160);
        const shown = pts.filter((p) => p[3] <= t);
        const now = shown.at(-1) ?? pts[0];
        const down = shown.length && now[2] === 1;
        const held = Math.max(0, Math.min(t, releaseAt) - pressAt);
        ctx.lineWidth = 1.5;
        ctx.font = "13px system-ui, sans-serif";
        ctx.textBaseline = "middle";
        if (kind === "checkbox" || kind === "pow") {
          const bx = kind === "checkbox" ? 52 : 34;
          rounded(bx, 62, 36, 36, 6);
          ctx.fillStyle = c.surface;
          ctx.fill();
          ctx.strokeStyle = c.muted;
          ctx.stroke();
          const clicked = t >= releaseAt && shown.length === pts.length;
          if (kind === "checkbox" && clicked) {
            ctx.strokeStyle = c.good;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(bx + 9, 81);
            ctx.lineTo(bx + 16, 88);
            ctx.lineTo(bx + 28, 72);
            ctx.stroke();
          }
          ctx.fillStyle = c.text;
          ctx.fillText(kind === "checkbox" ? "I'm not a robot" : "I am human", bx + 50, 80);
          if (kind === "pow") {
            const progress = clicked ? Math.min(1, (t - releaseAt) / 1600) : 0;
            rounded(bx + 50, 98, 200, 6, 3);
            ctx.fillStyle = c.line;
            ctx.fill();
            if (progress) {
              rounded(bx + 50, 98, 200 * progress, 6, 3);
              ctx.fillStyle = progress === 1 ? c.good : c.accent;
              ctx.fill();
            }
            ctx.fillStyle = c.muted;
            ctx.font = "11px system-ui, sans-serif";
            ctx.fillText(progress === 1 ? "verified" : progress ? "computing proof of work…" : "", bx + 50, 116);
          }
        } else if (kind === "hold") {
          rounded(50, 58, 220, 44, 22);
          ctx.fillStyle = c.surface;
          ctx.fill();
          const progress = Math.min(1, held / (releaseAt - pressAt || 1));
          if (progress) {
            ctx.save();
            ctx.clip();
            ctx.fillStyle = c.accent;
            ctx.globalAlpha = 0.25;
            ctx.fillRect(50, 58, 220 * progress, 44);
            ctx.restore();
          }
          rounded(50, 58, 220, 44, 22);
          ctx.strokeStyle = c.muted;
          ctx.stroke();
          ctx.fillStyle = c.text;
          ctx.fillText(progress >= 1 ? "Done ✓" : "Press & Hold", 150, 80);
          ctx.fillStyle = c.muted;
          ctx.font = "11px system-ui, sans-serif";
          ctx.fillText(held ? `held ${(held / 1000).toFixed(1)} s` : "", 150, 118);
          ctx.font = "13px system-ui, sans-serif";
        } else if (kind === "slide") {
          rounded(20, 62, 286, 36, 8);
          ctx.fillStyle = c.surface;
          ctx.fill();
          ctx.strokeStyle = c.muted;
          ctx.stroke();
          const hx = down || (t >= releaseAt && shown.length === pts.length) ? Math.min(286, Math.max(40, now[0])) : 40;
          ctx.fillStyle = c.accent;
          ctx.globalAlpha = 0.18;
          ctx.fillRect(21, 63, hx - 21, 34);
          ctx.globalAlpha = 1;
          rounded(hx - 20, 62, 40, 36, 8);
          ctx.fillStyle = c.text;
          ctx.fill();
          ctx.fillStyle = c.surface;
          ctx.fillText("›››", hx - 9, 80);
          ctx.fillStyle = c.muted;
          ctx.fillText("Slide to verify", 150, 80);
        }
        // Trail: moves with the button up thin, held thick.
        for (let i = 1; i < shown.length; i++) {
          ctx.beginPath();
          ctx.moveTo(shown[i - 1][0], shown[i - 1][1]);
          ctx.lineTo(shown[i][0], shown[i][1]);
          ctx.strokeStyle = shown[i][2] ? c.bad : c.accent;
          ctx.lineWidth = shown[i][2] ? 2 : 1.2;
          ctx.stroke();
        }
        ctx.fillStyle = c.accent;
        for (const p of shown) ctx.fillRect(p[0] - 1, p[1] - 1, 2, 2);
        ctx.beginPath();
        ctx.arc(now[0], now[1], down ? 6 : 4, 0, Math.PI * 2);
        ctx.fillStyle = down ? c.bad : c.surface;
        ctx.fill();
        ctx.strokeStyle = down ? c.bad : c.text;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = c.muted;
        ctx.font = "11px system-ui, sans-serif";
        ctx.fillText(`${pts.length} events · ${(track.duration / 1000).toFixed(1)} s`, 10, 14);
      }
      const total = track.duration + (kind === "pow" ? 1800 : 400);
      function play() {
        cancelAnimationFrame(raf);
        if (reduced.matches) return frame(total);
        const start = performance.now();
        const tick = (now) => {
          frame(now - start);
          if (now - start < total) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      }
      frame(reduced.matches ? total : 0);
      $(card, "[data-replay]").addEventListener("click", play);
      new IntersectionObserver((entries, obs) => entries.some((e) => e.isIntersecting) && (obs.disconnect(), play()), { threshold: 0.6 }).observe(card);
      matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => frame(total));
    }
    $$(document, "[data-track]").forEach(player);
  }
})();
