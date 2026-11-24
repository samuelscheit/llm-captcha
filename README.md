<div align="center">

# LLM Captcha Solver

**Your browser agent hits a captcha. This gets it through: with the vision model you choose, and with plain image analysis wherever a model would only guess.**

[![CI](https://github.com/samuelscheit/llm-captcha/actions/workflows/ci.yml/badge.svg)](https://github.com/samuelscheit/llm-captcha/actions/workflows/ci.yml)
[![Leaderboard](https://img.shields.io/badge/leaderboard-models_on_real_challenges-2f5bea)](https://samuelscheit.github.io/llm-captcha/)
[![How it works](https://img.shields.io/badge/explainer-interactive-1a7f4b)](https://samuelscheit.github.io/llm-captcha/how-it-works.html)
[![License: MIT](https://img.shields.io/badge/license-MIT-6b6a66)](LICENSE)

[What it solves](#what-it-solves) · [Leaderboard](#ai-model-captcha-leaderboard) · [Quick start](#quick-start) · [For agents](#for-agents) · [How it works](#how-it-works) · [Docs](#documentation)

<img src="docs/img/hero.svg" width="860" alt="A real reCAPTCHA round: the challenge, the labeled view the model gets, the tiles it picks clicked in order, solved">

</div>

## What it solves

<table>
<tr><th colspan="3" align="left">🧠 Vision model, with the targets labeled for it</th></tr>
<tr>
<td align="center" width="33%"><img src="docs/img/providers/recaptcha.png" width="260" alt="reCAPTCHA v2"><br><b>reCAPTCHA v2</b><br><sub>pick tiles, dynamic grids</sub></td>
<td align="center" width="33%"><img src="docs/img/providers/hcaptcha.png" width="260" alt="hCaptcha"><br><b>hCaptcha</b><br><sub>click points, animated</sub></td>
<td align="center" width="33%"><img src="docs/img/providers/geetest.png" width="260" alt="GeeTest v3 / v4"><br><b>GeeTest v3 / v4</b><br><sub>icons, nine-grid, match, gobang</sub></td>
</tr>
<tr>
<td align="center" width="33%"><img src="docs/img/providers/arkose.png" width="260" alt="Arkose / FunCaptcha"><br><b>Arkose / FunCaptcha</b><br><sub>carousel games</sub></td>
<td align="center" width="33%"><img src="docs/img/providers/yandex.png" width="260" alt="Yandex SmartCaptcha"><br><b>Yandex SmartCaptcha</b><br><sub>read text</sub></td>
<td align="center" width="33%"><img src="docs/img/providers/mtcaptcha.png" width="260" alt="MTCaptcha"><br><b>MTCaptcha</b><br><sub>read text</sub></td>
</tr>
<tr><th colspan="3" align="left">📐 Image analysis, then a human drag: no model</th></tr>
<tr>
<td align="center" width="33%"><img src="docs/img/providers/tencent.png" width="260" alt="Tencent TCaptcha"><br><b>Tencent TCaptcha</b><br><sub>slide puzzle</sub></td>
<td align="center" width="33%"><img src="docs/img/providers/yidun.png" width="260" alt="NetEase Yidun"><br><b>NetEase Yidun</b><br><sub>jigsaw</sub></td>
<td align="center" width="33%"><img src="docs/img/providers/dingxiang.png" width="260" alt="Dingxiang"><br><b>Dingxiang</b><br><sub>slide puzzle</sub></td>
</tr>
<tr>
<td align="center" width="33%"><img src="docs/img/providers/shumei.png" width="260" alt="Shumei"><br><b>Shumei</b><br><sub>slide puzzle</sub></td>
<td align="center" width="33%"><img src="docs/img/providers/aliyun.png" width="260" alt="AliyunCaptcha, nocaptcha"><br><b>AliyunCaptcha, nocaptcha</b><br><sub>puzzle, slide to end</sub></td>
<td align="center" width="33%"><img src="docs/img/providers/datadome.png" width="260" alt="DataDome"><br><b>DataDome</b><br><sub>slider</sub></td>
</tr>
<tr>
<td align="center" width="33%"><img src="docs/img/providers/gname.png" width="260" alt="GNAME"><br><b>GNAME</b><br><sub>slide to end</sub></td>
<td align="center" width="33%"><img src="docs/img/providers/generic.png" width="260" alt="Drag-verify and kit gates"><br><b>Drag-verify and kit gates</b><br><sub>slide to end</sub></td>
<td align="center" width="33%"><img src="docs/img/providers/dogwaf.png" width="260" alt="DogWAF and forks"><br><b>DogWAF and forks</b><br><sub>shifted grid, counting</sub></td>
</tr>
<tr><th colspan="3" align="left">✅ A click, a hold, or just waiting</th></tr>
<tr>
<td align="center" width="33%"><img src="docs/img/providers/turnstile.png" width="260" alt="Cloudflare Turnstile"><br><b>Cloudflare Turnstile</b><br><sub>checkbox</sub></td>
<td align="center" width="33%"><img src="docs/img/providers/human.png" width="260" alt="HUMAN / PerimeterX"><br><b>HUMAN / PerimeterX</b><br><sub>press & hold</sub></td>
<td align="center" width="33%"><img src="docs/img/providers/friendlycaptcha.png" width="260" alt="Friendly Captcha"><br><b>Friendly Captcha</b><br><sub>proof of work</sub></td>
</tr>
<tr>
<td align="center" width="33%"><img src="docs/img/providers/altcha.png" width="260" alt="ALTCHA"><br><b>ALTCHA</b><br><sub>proof of work</sub></td>
<td align="center" width="33%"><img src="docs/img/providers/mcaptcha.png" width="260" alt="mCaptcha"><br><b>mCaptcha</b><br><sub>proof of work</sub></td>
<td align="center" width="33%"><img src="docs/img/providers/anubis.png" width="260" alt="Anubis"><br><b>Anubis</b><br><sub>proof-of-work interstitial</sub></td>
</tr>
</table>

Also AWS WAF image grids, Cloudflare's "Just a moment…" interstitial, and text captchas on any site. Anything else takes a few lines of JSON: an [adapter](docs/adapters.md). The [coverage table](BENCHMARK.md#coverage) says when each adapter last passed against the real widget.

## AI model captcha leaderboard

[![Captcha solving leaderboard](benchmarks/leaderboard.svg)](BENCHMARK.md)

Which vision model solves which captcha: pass rates per challenge type on labeled real-world challenges, replayed exactly as the solver asks live, with tokens and dollars per solve. Measured again whenever a model, a fixture or the solver changes. Configure a primary model and fallbacks; a failed call moves on to the next. → [Full leaderboard and coverage](BENCHMARK.md) · [website](https://samuelscheit.github.io/llm-captcha/)

## Quick start

**Extension**, for any Chrome you or an agent drive:

```sh
git clone https://github.com/samuelscheit/llm-captcha.git && cd llm-captcha
bun install && bun run build          # → dist/extension
bun run update --install              # optional: hourly self-update
```

Load `dist/extension` at `chrome://extensions` (Developer mode → Load unpacked) and pick a model in its options page. Without a model, the extension asks whoever drives the browser ([assist mode](#assist-mode-no-model-needed)).

**Library**, for a browser you control:

```ts
import { solveCaptchas, playwrightHost, createModel } from "<checkout>/dist/cdp/index.js";

const host = await playwrightHost(page);
const result = await solveCaptchas(host, {
  models: [createModel({ provider: "anthropic", baseURL: "", apiKey, model: "claude-opus-5-5" })],
});
await host.dispose();
// result.state: "solved" | "failed" | "idle"
```

`puppeteerHost(page)` works the same; any OpenAI-compatible, OpenAI, Anthropic or Google model goes through the AI SDK.

> [!TIP]
> Run the browser the way a person's runs: headful, without `--enable-automation`, with `--disable-blink-features=AutomationControlled` (patchright does this by default). Many challenges check `navigator.webdriver` before they look at anything else.

## For agents

The top document always says what is going on:

```html
<html data-captcha-state="solving | solved | failed" data-captcha-detail="recaptcha-images">
```

A `captcha-state` event fires on `window` with every change. One line in your agent's prompt is enough: _"If `<html data-captcha-state>` is `solving`, wait until it is `solved` or `failed` before acting."_

### Assist mode: no model needed

Without a model configured, the extension puts each challenge to whoever drives the browser. A panel beside the challenge shows the labeled screenshot, the instruction and an answer field. Screenshot, DOM and accessibility-tree agents can all use it, and so can a person:

| Answer | Does |
|---|---|
| `t2 t5 verify` | clicks targets |
| `120,80` | clicks a point of the image |
| `drag 10,20 200,20` | drags between two points |
| `type XK4P9` | types (for text challenges the bare characters work too) |
| `3 0 7` | one value per input, when there are several |

The extension turns the answer into precise trusted input, reports errors back, and handles waits and retries as it would with a model.

## How it works

```mermaid
flowchart LR
  scan["🔍 Scan every frame<br/><sub>adapters find the challenge</sub>"] --> settle{"⏳ At rest?"}
  settle -- "loading, animating" --> scan
  settle -- yes --> solve["🧠 Solve<br/><sub>model or image analysis</sub>"]
  solve --> act["🖱️ Act like a person<br/><sub>trusted input, human tracks</sub>"]
  act --> verdict{"Verdict"}
  verdict -- "error: tell the model" --> scan
  verdict -- "twice wrong: new puzzle" --> scan
  verdict -- passed --> done(["✅ solved"])
```

Each round, the challenge is scanned in every frame, scrolled into view and uncovered (cookie banners and the like). Once it has stopped loading and animating, it is solved by the cheapest method that is sure. The answer is acted out as trusted input, and the widget's verdict is read. Errors go back to the model with the earlier rounds. → [Architecture](docs/architecture.md) · [**Try it on real challenges in the interactive explainer**](https://samuelscheit.github.io/llm-captcha/how-it-works.html)

### What the model sees

<img src="docs/img/method-vision.png" alt="Real rounds of reCAPTCHA, hCaptcha and Arkose: the screen, the labeled view the model gets, and its answer">

Animated challenges come as a burst of frames with what moved outlined, and earlier rounds come back with the errors they caused. Answers are checked against the challenge before anything is clicked.

### Slide puzzles: found, not guessed

<img src="docs/img/method-slider.png" alt="A real Tencent puzzle: the piece, the contrast score at every offset, and the gap it lands in">

Dark gaps and light ones alike. The drag nudges first, reads where the piece went, and corrects the rest, so pieces that lag their handle land too.

### DogWAF: a model where it helps, code where it does not

<img src="docs/img/method-shift.png" alt="A DogWAF challenge: the reference, the noisy rolled copy, the correlation of every roll, and the copy rolled back">

The model only finds Lulu's nose in the clean reference; the roll decides which square of the noisy copy gets the click.

<img src="docs/img/method-stamps.png" alt="DogWAF's counting challenge: a noisy image, the picture learned from all five, and the copies found pass by pass">

No model involved. Where the picture cannot be learned (the original DogWAF drops half of every copy's pixels), the model counts instead.

### Moving like a person

<img src="docs/img/method-gestures.svg" width="860" alt="Pointer tracks from the real gesture code: an eased approach to a click, a minimum-jerk drag, a held press">

Every click, drag and hold is a trusted CDP input event on a track planned by [`src/core/mouse.ts`](src/core/mouse.ts). Drags never go back before their overshoot: track-scoring sliders refuse a pointer that does.

## Documentation

- **[Interactive explainer](https://samuelscheit.github.io/llm-captcha/how-it-works.html)**: step through real challenges, puzzles and image analysis.
- **[Architecture](docs/architecture.md)**: drivers, the solve round, recovery, self-improvement.
- **[Adapters](docs/adapters.md)**: describe a new challenge: fields, kinds, carousels, shifted grids, stamps.
- **[Development](docs/development.md)**: build, tests, real challenges on demand, fixtures, the benchmark.
- **[AGENTS.md](AGENTS.md)**: the playbook for agents that run and improve this project.

## Contributing

Unsolved challenges are reported as issues with replayable fixtures. A fix starts from a captured failure and ends with that failure passing (`bun run eval`) and nothing else regressing (`bun run check`). [AGENTS.md](AGENTS.md) walks through it.

> [!NOTE]
> This project is for agents acting on behalf of their users: accessibility, testing your own sites, automating your own accounts. Respect the terms of the sites you visit.

[MIT](LICENSE)
