# Agent playbook

This project is meant to be run, inspected and improved by AI agents. Set it up from a git checkout, never from a packaged copy, so you can read the source behind any behaviour, change it, prove the change against real cases, and send it upstream.

`$REPO` below is the upstream repository (`owner/name` on GitHub).

## 1. Set it up for your browser

```sh
git clone https://github.com/$REPO.git llm-captcha-solver && cd llm-captcha-solver
bun install
bun run build                 # → dist/extension (unpacked extension), dist/cdp (library)
bun run update --install      # hourly self-update: fast-forward, build, test, swap dist/
```

Then pick the integration that fits your browser:

- **Extension**, for any browser you drive, including a user's normal Chrome. Load `dist/extension` unpacked (`chrome://extensions` → Developer mode → Load unpacked).
  - Under automation, branded Chrome 137+ ignores `--load-extension`. Launch with `--enable-unsafe-extension-debugging` and call CDP `Extensions.loadUnpacked({ path })` over the debugging pipe; `src/tools/browser.ts` shows how.
- **CDP library**, for Playwright/patchright or Puppeteer you control. Import from the checkout:

  ```ts
  import { solveCaptchas, playwrightHost, createModel } from "<checkout>/dist/cdp/index.js";
  const host = await playwrightHost(page);
  const result = await solveCaptchas(host, { models: [createModel({ provider: "anthropic", baseURL: "", apiKey, model: "claude-opus-5-5" })] });
  ```

Run the browser the way a person's runs: without announcing automation. Many challenges check `navigator.webdriver` before they even look at a click or a drag, and the solver cannot undo that from inside the page. patchright does this by default; for Puppeteer or Playwright, drop `--enable-automation` and add `--disable-blink-features=AutomationControlled` (`test/support/drivers.ts` shows the Puppeteer launch).

Configure the extension in its options page, or write the settings straight into `chrome.storage.local` under `settings`, with the shape `Settings` in `src/core/types.ts`:

- **Model:** any vision model through the AI SDK, plus optional fallback models.
- **Failure reports:** a GitHub token, the issues repository (`$REPO`), and a fixture repository you can push to (your fork if you cannot push upstream). Every unsolved challenge then becomes an issue with its fixtures attached.
- **Denylist:** sites where it must never act.

If the extension has no model configured, it asks you instead (assist mode). A dialog "Captcha: answer needed" shows the challenge with labeled targets; type your answer into the "Captcha answer" field and submit, using the syntax the dialog gives (e.g. `t2 t5 verify`). The extension performs the clicks.

While you browse, before acting on a page, check `document.documentElement.dataset.captchaState`:

- `solving`: wait (poll or listen for the `captcha-state` window event).
- `solved`: continue.
- `failed`: read `data-captcha-detail`. The session is reported if reports are on. Try another route or ask the user.

The extension updates itself: the updater rebuilds `dist/`, the extension sees a new `build.json` and reloads within a minute. Library users pick up the new `dist/cdp` on their next import.

One exception: if you load the extension through CDP `Extensions.loadUnpacked`, set `autoReload: false` in its settings. Chrome unloads such an extension on `chrome.runtime.reload()` instead of reloading it. Each launch loads the current `dist/` anyway.

## 2. Improve it

Work from facts, never from guesses: every fix starts from a captured failure and ends with that failure passing.

1. **Get the failures.**
   - `bun run pull-reports` restores every reported failure from the open `challenge-failure` issues into `fixtures/captured/<provider>/`, with `issue.txt` naming its issue.
   - Or capture yourself: `bun run capture <url> --sessions 3`.
2. **Look at each round.** You see what the model saw:
   - `labeled.png` is the current frame with target ids;
   - `frame-N.png` are the burst frames;
   - `fixture.json` holds the view (targets, instruction, errors), the model's decision and `observed.errorsAfter`, the widget's verdict;
   - `dom.html` is the challenge frame's markup, closed shadow roots included.
3. **Label it.**
   - Set `expected` in `fixture.json` (formats in `README.md`) and write in `notes` what is on the screen and why the answer is right.
   - Zoom in on the frames before deciding: a label that is wrong is worse than none.
   - When you cannot tell, keep `"expected": null` and say so in `notes`.
   - Move the directory to `fixtures/<provider>/<descriptive-name>/`.
4. **Reproduce:** `bun run eval --filter <provider>/<name> --runs 3`.
5. **Find the root cause and fix it there.** Typical causes:
   - **Wrong view** (targets, selection state, instruction, errors): adapter selectors in `src/core/adapters.ts` or the scanner in `src/page/`. Check against `dom.html`.
   - **Right view, wrong answer:** the prompt in `src/core/prompt.ts`, what the image shows (labels, frames, scale in `src/core/engine.ts`), or a model limit. Prefer giving the model better evidence over adding rules.
   - **Right answer, wrong effect:** the coordinates, timing or gestures (`src/core/engine.ts`, `src/core/mouse.ts`, the drivers).
   - **Unknown challenge:** look at it with `bun run explore <url> [--fill selector=value] --click <selector that opens it>`, which saves every frame's element tree (closed shadow roots included), its HTML and a screenshot to `out/explore/`. Then add an adapter, plus a local e2e page in `test/support/server.ts` that copies its structure. For a widget whose site key is bound to a domain, add the page to `src/tools/vendor-pages.ts` and add a live test in `test/live/`.
6. **Prove it.**
   - `bun run eval` (all fixtures: no regressions).
   - `bun run check` (typecheck, unit, e2e on extension, Playwright and Puppeteer).
   - For a prompt or engine change: `bun run bench` re-measures every model and shows in `BENCHMARK.md` whether the change helped across models, not only the one you tried. Commit the updated `BENCHMARK.md` and `benchmarks/results.json` with the change.
7. **Upstream it.**
   - Branch, commit the fix together with the new fixtures, and open a PR against `$REPO` using the PR template.
   - Put "Fixes #N" for each issue from `issue.txt`.
   - Once merged, every installation picks it up through its updater.

Keep the fixture set honest. Fixtures record real challenges and the true answer, including the cases the model still gets wrong. Never relabel a fixture to make the eval pass.

## Repository map

| Path | What |
|---|---|
| `src/core/` | engine (solve loop, readiness, escalation), adapters, prompt, model call, gestures, CDP input, fixtures, scoring, GitHub reports |
| `src/page/` | code that runs inside page frames: scanner, canvas image tools, state publishing, DOM snapshot |
| `src/extension/` | MV3 extension: content script, driver, service worker (runs, reports, self-reload), options page |
| `src/cdp/` | CDP driver and its Playwright and Puppeteer hosts |
| `src/tools/` | developer and operations tools, each a `bun run` script: `explore` (frame trees for writing adapters), `capture`, `eval`, `bench` (`benchmark/`: leaderboard, SVG, Pages site), `pull-reports`, `update`; plus what they share: `browser.ts` (Chrome with the extension), `vendor-pages.ts` (real widgets under their domain), `fixtures.ts`, `replay.ts`, `model.ts` |
| `test/live` | real vendor widgets over the network (`bun run live`), outside `check` |
| `benchmarks/`, `BENCHMARK.md` | models on the leaderboard, their results per fixture, the leaderboard |
| `test/unit`, `test/e2e` | unit tests; local challenge pages and real vendor test widgets under every driver (mock model) |
| `fixtures/<provider>/<name>/` | labeled real challenges replayed by `bun run eval` |
