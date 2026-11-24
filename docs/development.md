# Development

- [Commands](#commands)
- [Real challenges on demand](#real-challenges-on-demand)
- [Fixtures](#fixtures)
- [Benchmark](#benchmark)
- [Docs visuals and the site](#docs-visuals-and-the-site)

Agents improving the solver: [AGENTS.md](../AGENTS.md) is the step-by-step playbook.

## Commands

```sh
bun install
bun run build        # dist/page.js, dist/extension/, dist/cdp/
bun run typecheck
bun run test         # unit tests
bun run e2e          # local challenge pages, page fixtures and vendor test widgets × {extension, Playwright, Puppeteer}, mock model
bun run check        # all of the above
bun run live         # real widgets over the network (third parties: not part of check)
bun run eval         # replay labeled fixtures through the live model, and the image-analysis fixtures
bun run bench        # every model in benchmarks/models.json → BENCHMARK.md
bun run docs         # README visuals in docs/img/, rendered from fixtures
```

Tests and tools drive headful local Chrome through patchright: challenges detect automation and headless browsers. Branded Chrome ignores `--load-extension`, so the harness loads the extension through CDP `Extensions.loadUnpacked`. `BROWSER=chromium` uses patchright's bundled Chromium instead (`bunx patchright install chromium` once).

The live model for capture and eval is set by `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_API_KEY` and `LLM_MODEL`.

## Real challenges on demand

```sh
bun run explore --vendor recaptcha   # every frame's element tree, HTML and a screenshot → out/explore/
bun run explore <url> --fill "input[name=email]=a@example.com" --click "a.get_code"
```

The vendor recipes in [`src/tools/vendor-pages.ts`](../src/tools/vendor-pages.ts) bring up each real challenge, for `explore`, `capture` and the live tests:

- the reCAPTCHA and hCaptcha demos, and Turnstile forced interactive;
- Tencent under its own domain (vendors bind site keys to domains, so our page is served at a URL of that domain);
- Aliyun's `nc` slider with the public test appkey of Aliyun's demos, and AliyunCaptcha 2.0 on Alibaba Cloud's password reset page;
- the forms that guard GNAME's and Eranet's sliders (filled with a black-hole address);
- DogWAF on its author's Forgejo, with a token that fails the automatic check to bring up the captcha.

## Fixtures

The model's accuracy is what matters most, so real challenges are kept as fixtures:

```sh
bun run capture --vendor recaptcha --sessions 3      # or any URL
bun run capture --accept --vendor geetest-v4-nine --vendor yidun --sessions 3
#   → fixtures/captured/<provider>/<time>-<adapter>-r<round>/
#     fixture.json, frame-N.png, labeled.png
```

With `--accept`, what the vendor itself accepted is labeled automatically and goes straight into `fixtures/<provider>/`; everything else stays in `fixtures/captured/` for a person:

- **Model rounds:** in a session the vendor passed, every round it did not object to, with the model's answer as the expected one.
- **Slide puzzles:** the passing slide, as a slider fixture with both images as measured.

To label a round, look at the frames, write `expected` and `notes` into `fixture.json`, and move the directory to `fixtures/<provider>/<name>/` (the provider is the first segment of the adapter id). Fixtures you are unsure about keep `"expected": null` and a note; eval skips them. Never relabel a fixture to make eval pass.

| `expected` | Means |
|---|---|
| `{"clicks": ["t2", "t5", "verify"]}` | exactly these targets, any order |
| `{"text": "XK4P9"}` | typed text, case-insensitive unless `caseSensitive` |
| `{"points": [{"x": 120, "y": 80, "r": 30}], "clicks": ["submit"]}` | one click inside each circle (CSS px relative to the region) |

Fixture kinds that need no model:

| `kind` | Files | Checked by |
|---|---|---|
| `slider` | `background.png`, `piece.png`, `origin`, `expected.offset` (background px) | eval, unit tests |
| `shift` | `reference.png`, `challenge.png`, `grid`, `expected: { dx, dy }`: the roll the server issued or accepted | eval, unit tests |
| `count` | `image-1.png`…, `stamps`, `expected.counts`; `counted: false` means image analysis must decline | eval, unit tests |
| `page` | `page.html` (a real page, sanitized) and its files, `expected: { state, navigatesTo }` or a scan snapshot `views` | e2e, every driver |

Page fixtures are served at `/fixture/<provider>/<name>/`. Files next to `page.html` are served at the absolute paths the page asks for (`/dogcaptcha/compat.png?i=2` is `compat-2.png`). Pages that answer by navigating declare `redirects`, the query of the right answer and where it leads; `model` is the mock model's answer to the challenge's `instruction`.

```sh
bun run eval                                  # everything
bun run eval --filter recaptcha/ --runs 3     # by "<provider>/<name>" substring
```

## Benchmark

[BENCHMARK.md](../BENCHMARK.md) (also at [samuelscheit.github.io/llm-captcha](https://samuelscheit.github.io/llm-captcha/)) shows each model's pass rate per challenge type on the labeled fixtures, replayed exactly as the solver asks live, and what it costs: median tokens per run, and dollars per run and per solved challenge at the provider's API list price ([genai-prices](https://github.com/pydantic/genai-prices)), input priced uncached.

`bun run bench` updates it incrementally: only (model, fixture) pairs whose fixture or solver code changed are measured again, so adding a fixture or a model costs a few calls. Provider outages are retried later instead of counted. Models come from `benchmarks/models.json`:

- explicit entries, with keys from the environment (`${ANTHROPIC_API_KEY}`, …);
- a `discover` entry, which adds every model an OpenAI-compatible gateway lists (`${GATEWAY_URL}/models`).

A model the gateway refuses for good (for example no image input) is recorded as unsupported and not tried again. A local `benchmarks/models.local.json` overrides the list.

The weekly CI workflow benchmarks models that were never measured, commits the leaderboard and its chart, and deploys the site. For a prompt or engine change, run `bun run bench` locally and commit the result with the change. CI needs the secret `GATEWAY_KEY` and the variable `GATEWAY_URL` (or a provider's `*_API_KEY`).

The **coverage** table below the models lists every adapter, how it is solved and when that was last verified against the real widget. Tests against real widgets name their adapters in their titles (`[aliyun-nc]`), and `bun run live` and `bun run e2e` merge their results into `benchmarks/verified.json`, failures included.

## Docs visuals and the site

`bun run docs` renders the README's figures into `docs/img/` from fixtures and the real image-analysis and gesture code, so they show what the solver actually computes; `bun run docs --capture` refreshes the provider screenshots from the live demos. The site (`out/site/`: the leaderboard and the interactive explainer) is built by `bun src/tools/benchmark/publish.ts` and deployed by `.github/workflows/pages.yml`.
