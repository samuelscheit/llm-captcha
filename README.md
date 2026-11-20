# LLM Captcha Solver

[![Captcha solving leaderboard](benchmarks/leaderboard.svg)](BENCHMARK.md)

Below the models, the leaderboard has a **coverage** table: every challenge the solver recognizes, how it solves each (checkbox click, image analysis and drag, slide to end, vision model), and when that was last verified against the real widget. Verification is recorded from test runs, not claimed by hand. Tests against real widgets name the adapters they exercise in their titles (`[aliyun-nc]`), and `bun run live` and `bun run e2e` merge their results into `benchmarks/verified.json`, including failures.

Solves verification challenges with a vision model of your choice, for AI agents that drive a browser:

- **Checkbox and image challenges:** reCAPTCHA v2, hCaptcha, Cloudflare Turnstile, Yandex SmartCaptcha, AWS WAF, Arkose Labs/FunCaptcha, MTCaptcha, text captchas.
- **Slide puzzles and sliders:** GeeTest v3/v4 (and its icon, nine-grid, match and gobang tasks), Tencent TCaptcha, AliyunCaptcha and Aliyun nocaptcha, NetEase Yidun, Shumei, Dingxiang, DataDome, GNAME, drag-verify and phishing-kit gates.
- **Press & hold:** HUMAN/PerimeterX.
- **Proof-of-work checks and interstitials:** Friendly Captcha, ALTCHA, mCaptcha, Anubis, Cloudflare's "Just a moment…".
- **Anything else** you describe with an adapter.

Which of these were verified against the real widget, and when, is in the [leaderboard's coverage table](BENCHMARK.md#coverage).

It is built to be run and improved by agents. Unsolved challenges are reported as GitHub issues with replayable fixtures, fixes are proven against those fixtures, and installations update themselves. **Agents: start with [AGENTS.md](AGENTS.md).**

It ships as two things that share one engine:

- **A Chrome extension** that works on its own. Any agent driving the browser (Grok, Claude, browser-use, a script) benefits without integration.
- **A CDP library** for Playwright/patchright, Puppeteer or a raw CDP connection: `solveCaptchas(host)`.

## How the agent knows what is going on

The top document publishes the state:

```html
<html data-captcha-state="solving|solved|failed" data-captcha-detail="recaptcha-images"></html>
```

A `captcha-state` event fires on `window` with every change. One line in the agent's prompt is enough: _"If `<html data-captcha-state>` is `solving`, wait until it is `solved` or `failed` before acting."_

## Architecture

```
src/core/       runtime-agnostic: engine (solve loop), adapters, prompt, model call (AI SDK),
                gesture plans, CDP input, scoring
src/page/       runs inside page frames (isolated world): scanner, canvas image tools
                (crop, label, motion), state publishing
src/extension/  MV3 extension: content script (scanner + frame offsets + wake-up),
                ExtensionDriver (chrome.scripting + chrome.debugger), options page
src/cdp/        CdpDriver over any CDP session provider; Playwright and Puppeteer hosts
src/tools/      developer and operations tools (`bun run <name>`): explore, capture, eval,
                bench (benchmark/), pull-reports, update, and what they share
fixtures/       real challenges by provider (recaptcha/, hcaptcha/, tencent/), replayed by eval and bench
test/           unit, e2e (local pages + vendor test widgets, every driver), live (real widgets)
```

The engine talks to a browser only through `Driver` (`src/core/driver.ts`): `scan`, `reveal`, `input` (trusted mouse and keys, screenshots), `images` and `publish`.

- **ExtensionDriver.** Content scripts in every frame scan, and resolve frame offsets by asking their parent frame. `chrome.debugger` is attached only while a challenge is being solved, for trusted input.
- **CdpDriver.** The page bundle (`dist/page.js`) is injected into an isolated world per frame, which page scripts cannot see. Out-of-process frames are found through `iframe` targets. Closed shadow roots (Turnstile) are read with `DOM.getDocument({pierce})` and handed to the scanner.

Each solve round:

1. Scan every frame for challenges and pick the open popup over its checkbox.
2. Scroll it into view.
3. Capture a burst of frames (for animated challenges) and find the regions that moved.
4. Label targets on the image and ask the model for actions.
5. Run the actions as human-like CDP gestures (eased approach, minimum-jerk drags, focus emulation).
6. Read the widget's verdict and feed errors into the next round.

Checkboxes are clicked without a model, spaced so the vendor's verdict can arrive (Turnstile restarts its check on every click).

The model is asked only about a challenge at rest. These checks cost no round:

- **Loading or animating:** the scanner reports a challenge as `waiting` while an image in it is still loading or a finite CSS animation or transition is running, such as reCAPTCHA's replacement tiles fading in.
- **Still changing on screen:** each round's frames are compared; any change in a non-animated challenge, or a change across most of an animated one, means it has not settled.
- **Moved while the model thought:** the challenge is scanned again just before acting, and the answer is dropped if the challenge moved meanwhile.

Animated challenges (`point` by default, or `animated: true` in the adapter) are captured as 3 frames 300 ms apart. hCaptcha fades its shapes in and out, so a single frame hides some of them. The model gets every frame, with the moving regions outlined and listed.

## Recovering by itself

When a challenge goes wrong, the engine responds in steps:

- **Wrong answer:** the widget's error goes back to the model with the earlier rounds.
- **Two rejections in a row:** the engine asks the widget for a new puzzle (its reload button) and starts with a fresh history.
- **Failed model call:** the next configured fallback model takes over.
- **Lost wake-up:** a frame that stays pending wakes the service worker again every few seconds, which covers a restarted service worker or a run that was just ending.
- **Stalled call:** every wait, screenshot and model call ends at the session deadline.
- **Failed session:** the page reads `failed` with a reason. The extension does not retry that tab (no paid loops) until it navigates.

## Improving itself

1. **Failure reports.** With reports configured (options page, or `reportToGitHub` in the library), a failed session pushes its last rounds as fixtures and the challenge frame's markup to a `fixtures/<provider>/<time>` branch. It then files a `challenge-failure` issue showing what the model saw, or comments on the open one with the same title. Page URLs are reported without query or fragment.
2. **Triage.** `bun run pull-reports` restores reported rounds into `fixtures/captured/`. You or an agent label them, reproduce with `bun run eval`, fix the root cause, and open a PR that carries the new fixtures.
3. **Self-update.** `bun run update --install` checks hourly. It accepts only fast-forwards of a clean checkout, builds into a staging directory and swaps it in only when the unit tests pass, so a broken commit never reaches `dist/`. The extension notices the new `build.json` and reloads itself between solves.

    Updates run code from the upstream branch in your browser: point the checkout at a repository you trust.

## Model

Pick any provider through the AI SDK: OpenAI-compatible (xAI, Ollama, OpenRouter, …), OpenAI, Anthropic or Google. Set the endpoint, key and model in the options page. The key stays in `chrome.storage.local`.

**No model configured: assist mode.** The extension then puts each challenge to whoever drives the browser. A panel on the page, placed away from the challenge, shows the labeled screenshot, the instruction and the answer syntax, with a labeled input. Screenshot, DOM and accessibility-tree agents can all read and use it, and so can a person; `data-captcha-detail` says an answer is needed. The answer syntax:

- `t2 t5 verify` clicks targets;
- `120,80` clicks a point of the image;
- `drag 10,20 200,20` drags between two points;
- `type XK4P9` types (for text challenges the bare characters work too).

The extension turns the answer into precise trusted clicks, reports errors back, and handles the readiness waits and retries as with a model. Agents that decline CAPTCHAs by policy will decline this too.

To choose one, see the **[leaderboard](BENCHMARK.md)**, also published at **[samuelscheit.github.io/llm-captcha](https://samuelscheit.github.io/llm-captcha/)**. It shows each model's pass rate per challenge type (provider × kind) on the labeled real-world fixtures, replayed exactly as the solver asks live.

`bun run bench` updates it incrementally. It re-measures only (model, fixture) pairs whose fixture or solver code changed, so adding a fixture or a model costs a few calls. Provider outages are retried later instead of counted.

Models come from `benchmarks/models.json`:

- explicit entries, with keys from the environment (`${ANTHROPIC_API_KEY}`, …);
- a `discover` entry, which adds every model an OpenAI-compatible gateway lists (`${GATEWAY_URL}/models`).

A model the gateway refuses for good (for example no image input) is recorded as unsupported and not tried again. A local `benchmarks/models.local.json` overrides the list.

The weekly CI workflow checks the gateway for models that were never measured and stops right there if there are none. Otherwise it benchmarks just the new ones, commits the leaderboard and this chart, and deploys the page to GitHub Pages. For a prompt or engine change, run `bun run bench` locally and commit the result with the change; pushing new results deploys the page too. CI needs the secret `GATEWAY_KEY` and the variable `GATEWAY_URL` (or a provider's `*_API_KEY`).

## Adapters

A challenge is described declaratively. These selectors are what the scanner uses:

```json
{
	"id": "my-grid",
	"kind": "select",
	"url": "widgets\\.example\\.com/challenge",
	"root": "#challenge",
	"instruction": [".prompt"],
	"errors": [".error"],
	"solved": ".success",
	"targets": [
		{ "id": "t", "selector": ".tile", "all": true, "selected": ".is-selected" },
		{ "id": "verify", "selector": "button.verify", "labelFromText": true }
	]
}
```

The `kind` field takes one of these values:

- `checkbox`: click it, no model. Without targets, the adapter only recognizes a check that runs by itself (Anubis, Cloudflare's interstitial): the session waits for it, or ends on a refusal.
- `hold`: press the `handle` and keep holding, with slight pointer movement, until the widget is done (Press & Hold). It waits for the widget to arm first and retries when its progress never starts.
- `select`: pick targets.
- `text`: read and type.
- `point`: click or drag positions; captured as 3 frames by default, to see animations.
- `slider`: drag the `handle`; no model involved. It has two modes:
  - **Puzzle**: until the `piece` image fits the gap in the `background` image (Tencent, GeeTest, AliyunCaptcha, Yidun, Shumei, Dingxiang). The gap is found by image analysis, since the drop must land within a few pixels. The images may be `<img>`, `<canvas>` or CSS backgrounds and are measured as shown. Dark and light gaps both work. The drag starts with a short nudge, reads where the piece went, and corrects the rest, so pieces that lag their handle land too. An ambiguous gap, or the same puzzle after a failed slide, gets a new puzzle (`reload`) instead of a guess. Images that only show under the pointer (float mode) are revealed by hovering the handle.
  - **Slide to end**: without a piece, the handle goes past the end of its `rail` (Aliyun nocaptcha and slide, GNAME, DataDome simple, kit gates) on a human track that never goes back.

  A refused slider that shows only a `reload` ("error, click to refresh") gets it clicked.

A `select` adapter can also declare a `carousel` (Arkose's "use the arrows" games). The engine then pages through all options, shows the model one contact sheet with the options labeled `o1`…`oN`, goes to its pick and submits.

Custom adapters go in the options page; the built-ins are in `src/core/adapters/`, one file per provider.

## Development

```sh
bun install
bun run build        # dist/page.js, dist/extension/, dist/cdp/
bun run typecheck
bun run test         # unit tests
bun run e2e          # local challenge pages and real vendor test widgets × {extension, Playwright, Puppeteer}, mock model
bun run check        # all of the above
bun run live         # real widgets over the network (third parties: not part of check)
bun run explore --vendor recaptcha   # every frame's element tree, HTML and a screenshot → out/explore/
bun run explore <url> --fill "input[name=email]=a@example.com" --click "a.get_code"
```

`explore` is where a new adapter starts. Its vendor recipes (`src/tools/vendor-pages.ts`) bring up each real challenge:

- the reCAPTCHA and hCaptcha demos, and Turnstile forced interactive;
- Tencent under its own domain (vendors bind site keys to domains, so our page is served at a URL of that domain);
- Aliyun's `nc` slider with the public test appkey of Aliyun's demos;
- AliyunCaptcha 2.0 on Alibaba Cloud's password reset page, where it shows without any trigger;
- the forms that guard GNAME's and Eranet's sliders (filled with a black-hole address).

`capture --vendor <name>` and the live tests use the same recipes. The live suite currently solves:

- the real Tencent puzzle (valid ticket);
- AliyunCaptcha 2.0 on Alibaba Cloud ("Verified");
- Aliyun's `nc` slider (Aliyun's server passes the first slide);
- GNAME's and Eranet's form sliders (accepted and closed).

`BROWSER=chromium` runs the tools and tests with patchright's bundled Chromium instead of the installed Chrome (`bunx patchright install chromium` once).

The e2e tests run headful local Chrome. Branded Chrome ignores `--load-extension`, so the harness loads the extension through CDP `Extensions.loadUnpacked`.

### Fixtures: replayable real challenges

The model's accuracy is what matters most, so real challenges are kept as fixtures:

```sh
bun run capture --vendor recaptcha --sessions 3      # or any URL
bun run capture --accept --vendor geetest-v4-nine --vendor yidun --sessions 3
#   → fixtures/captured/<provider>/<time>-<adapter>-r<round>/
#     fixture.json, frame-N.png, labeled.png
```

With `--accept`, what the vendor itself accepted is labeled automatically and goes straight into `fixtures/<provider>/`, while everything else stays in `fixtures/captured/` for a person:

- **Model rounds:** in a session the vendor passed, every round it did not object to, with the model's answer as the expected one.
- **Slide puzzles:** the passing slide, as a slider fixture with both images as measured.

Each captured round holds the view, the frames, what the model saw, its decision and the errors the widget showed afterwards. To label one, look at the frames, write `expected` and `notes` into `fixture.json`, and move the directory to `fixtures/<provider>/<name>/` (for example `fixtures/recaptcha/dynamic-bus-1/`). The provider is the first segment of the adapter id. Fixtures you are unsure about keep `"expected": null` and a note; eval skips them. The `expected` field is one of these forms:

- `{"clicks": ["t2", "t5", "verify"]}`
- `{"text": "XK4P9"}`
- `{"points": [{"x": 120, "y": 80, "r": 30}], "clicks": ["submit"]}` (CSS px relative to the region)

Two more fixture kinds need no model:

- **Slide puzzles** (`fixtures/tencent/`): `background.png`, `piece.png`, and a `fixture.json` with `kind: "slider"`, the piece's `origin` and the `expected` gap `offset`, in background pixels. `eval` checks them.
- **Page fixtures** (`fixtures/generic/`): `page.html`, a real challenge page saved as captured (links to elsewhere rewritten to local stand-ins), and a `fixture.json` with `kind: "page"` and the `expected` outcome (`state`, `navigatesTo`). The e2e suite serves them and solves them under every driver.

```sh
bun run eval                       # replay all labeled fixtures through the model, score them
bun run eval --filter recaptcha/ --runs 3    # filter by "<provider>/<name>" substring
bun run bench                                # every model in benchmarks/models.json → BENCHMARK.md
```

The live model for capture and eval is set by `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_API_KEY` and `LLM_MODEL`.
