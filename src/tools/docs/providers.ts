/**
 * docs/img/providers/<provider>.png: one 480×300 thumbnail (at 2x: 960×600 pixels) per provider the solver covers (the
 * coverage table's provider column). Real screenshots: a fixture's frame, slide puzzle or page
 * where one exists; otherwise the live widget captured once with `--capture` into
 * docs/img/providers/raw/, which is committed so the normal run is offline.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { BrowserContext, Frame, Page } from "patchright";
import { BUILTIN_ADAPTERS } from "../../core/adapters/index";
import type { Fixture } from "../../core/fixture";
import { coverage } from "../benchmark/coverage";
import { openVendorPage, vendorPage } from "../vendor-pages";
import { captureBox, COLOR, contentBox, crop, dataUrl, emulateScale, encodePng, fileUrl, fixturePath, OUT, readJson, readPng, type Renderer } from "./render";
import { lastFrame } from "./vision";

/** CSS size of a thumbnail; saved at SCALE pixels per CSS pixel. */
const [W, H] = [480, 300];
const SCALE = 2;
const RAW = path.join(OUT, "providers/raw");

/** Where a provider's picture comes from: a recorded round, a slide puzzle, a page fixture, an image. */
type Source = { frame: string } | { slider: string } | { page: string; selector: string };

const FROM_FIXTURES: Record<string, Source> = {
  recaptcha: { frame: "recaptcha/2026-11-20T21-27-27-321Z-recaptcha-images-r2" },
  hcaptcha: { frame: "hcaptcha/2026-11-20T21-25-03-257Z-hcaptcha-challenge-r1" },
  tencent: { slider: "tencent/tencent-slider-2026-11-20T21-40-48-203Z" },
  yidun: { slider: "yidun/yidun-jigsaw-2026-11-20T21-43-31-101Z" },
  dingxiang: { slider: "dingxiang/dingxiang-slider-2026-11-20T21-47-10-135Z" },
  geetest: { frame: "geetest/2026-11-20T21-15-32-106Z-geetest-v4-click-r1" },
  datadome: { page: "datadome/slider-leboncoin", selector: "#captcha__frame" },
  arkose: { frame: "arkose/2026-11-20T21-21-16-474Z-arkose-game-r1" },
  yandex: { frame: "yandex/2026-11-20T21-19-54-041Z-yandex-text-r1" },
  mtcaptcha: { frame: "mtcaptcha/2026-11-20T21-20-47-396Z-mtcaptcha-r1" },
  dogwaf: { frame: "dogwaf/grid-lulu-fork" },
  generic: { page: "generic/slide-to-verify-kit", selector: "#sliderContainer, .slider-container:has(.slider-thumb)" },
};

/** Vendor pages (src/tools/vendor-pages.ts) that bring up the providers without fixtures. */
const LIVE: Record<string, string> = {
  turnstile: "turnstile",
  aliyun: "alibaba-reset",
  shumei: "shumei",
  human: "human",
  friendlycaptcha: "friendlycaptcha-v2",
  altcha: "altcha",
  mcaptcha: "mcaptcha",
  anubis: "anubis",
  gname: "gname",
};

export const providers = () => [...new Set(coverage(BUILTIN_ADAPTERS, {}).map((r) => r.provider))];

const rawFile = (provider: string) => path.join(RAW, `${provider}.png`);

/** A picture and its pixels per CSS pixel. */
interface Picture {
  png: Buffer;
  scale: number;
}

/** The picture of a fixture source. Recorded frames are 1x; what is rendered here is SCALE. */
async function picture(renderer: Renderer, source: Source): Promise<Picture> {
  const rendered = async (html: string, selector: string, viewportWidth: number) => ({ png: await renderer.element(html, selector, viewportWidth, SCALE), scale: SCALE });
  if ("frame" in source) {
    const dir = fixturePath(source.frame);
    const fixture = readJson<Fixture>(`${dir}/fixture.json`);
    // A sheet of options (Arkose shows the challenge once per option): the first one is the challenge.
    const option = fixture.view.targets.find((t) => t.id === "o1");
    if (!option) return { png: readFileSync(lastFrame(dir)), scale: 1 };
    const { region } = fixture.view;
    const k = readPng(lastFrame(dir)).width / region.width;
    const crop = `position:absolute;left:${-(option.rect.x - region.x) * k}px;top:${-(option.rect.y - region.y) * k}px`;
    const html = `<!doctype html><body style="margin:0"><div id="c" style="position:relative;overflow:hidden;width:${option.rect.width * k}px;height:${option.rect.height * k}px"><img src="${fileUrl(lastFrame(dir))}" style="${crop}"></div>`;
    return rendered(html, "#c", 1600);
  }
  if ("slider" in source) {
    const dir = fixturePath(source.slider);
    const { origin } = readJson<{ origin: { x: number; y: number } }>(`${dir}/fixture.json`);
    const html = `<!doctype html><body style="margin:0"><div id="c" style="position:relative;display:inline-block"><img src="${fileUrl(`${dir}/background.png`)}" style="display:block"><img src="${fileUrl(`${dir}/piece.png`)}" style="position:absolute;left:${origin.x}px;top:${origin.y}px;filter:drop-shadow(0 2px 6px rgba(0,0,0,.45))"></div>`;
    return rendered(html, "#c", 1600);
  }
  return rendered(readFileSync(fixturePath(source.page, "page.html"), "utf8"), source.selector, 1280);
}

/** Share of the frame's width (or height, when taller) the widget fills. */
const FILL = 0.88;
/** Device pixels per captured pixel, at most: more would only blur. */
const MAX_UPSCALE = 2;

/** The widget cropped to its content, fitted to FILL of the frame without upscaling past MAX_UPSCALE. */
function thumbnail({ png: raw, scale }: Picture): string {
  const full = readPng(raw);
  const pixels = crop(full, contentBox(full));
  const png = encodePng(pixels);
  const [width, height] = [pixels.width / scale, pixels.height / scale];
  const zoom = Math.min((FILL * W) / width, (FILL * H) / height, (MAX_UPSCALE * scale) / SCALE);
  return `<!doctype html><html><head><style>
html,body{margin:0}#t{width:${W}px;height:${H}px;display:grid;place-items:center;background:${COLOR.bg};overflow:hidden}
img{border-radius:8px;box-shadow:0 1px 2px rgba(0,0,0,.08),0 6px 20px rgba(0,0,0,.10);background:#fff}
</style></head><body><div id="t"><img src="${dataUrl(png)}" width="${Math.round(width * zoom)}" height="${Math.round(height * zoom)}"></div></body></html>`;
}

/** One thumbnail per provider; providers with neither a fixture nor a capture are listed as missing. */
export async function providerThumbnails(renderer: Renderer): Promise<string[]> {
  const written: string[] = [];
  const missing: string[] = [];
  for (const provider of providers()) {
    const source = FROM_FIXTURES[provider];
    // Live captures are taken at SCALE.
    const shot = source ? await picture(renderer, source) : existsSync(rawFile(provider)) ? { png: readFileSync(rawFile(provider)), scale: SCALE } : undefined;
    if (!shot) {
      missing.push(provider);
      continue;
    }
    written.push(await renderer.shoot(`providers/${provider}.png`, thumbnail(shot), "#t", W, SCALE));
  }
  if (missing.length) console.warn(`providers without a picture (no fixture; run --capture ${missing.join(",")}): ${missing.join(", ")}`);
  return written;
}

/** The adapter roots of a provider that show a challenge (not a block page). */
const rootsOf = (provider: string) =>
  BUILTIN_ADAPTERS.filter((a) => a.id.split("-")[0] === provider && !a.id.endsWith("-blocked")).map((a) => a.root);

/** The first visible challenge root in any frame, within `timeoutMs`. */
async function findRoot(page: Page, roots: string[], timeoutMs: number): Promise<{ frame: Frame; selector: string } | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      for (const selector of roots) {
        const box = await frame.locator(selector).first().boundingBox({ timeout: 200 }).catch(() => null);
        if (box && box.width > 20 && box.height > 20) return { frame, selector };
      }
    }
    await page.waitForTimeout(500);
  }
  return undefined;
}

/** Capture the live widgets of `names` (default: every LIVE provider) into docs/img/providers/raw/. */
export async function captureProviders(context: BrowserContext, names: string[]): Promise<Record<string, string>> {
  const report: Record<string, string> = {};
  mkdirSync(RAW, { recursive: true });
  for (const provider of names.length ? names : Object.keys(LIVE)) {
    const vendor = LIVE[provider];
    if (!vendor) {
      report[provider] = "no vendor page";
      continue;
    }
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(60_000);
    try {
      // Interstitials (Anubis) reload the page while it loads: the challenge may still be there.
      const opened = await openVendorPage(context, page, vendorPage(vendor), { reveal: true }).then(
        () => "",
        (error: Error) => ` after "${error.message.split("\n")[0]}"`,
      );
      const found = await findRoot(page, rootsOf(provider), 30_000);
      if (!found) {
        report[provider] = `no challenge root appeared${opened}`;
        continue;
      }
      // A widget in its own frame is shown whole (with its branding): the frame's element.
      const target = found.frame === page.mainFrame() ? await found.frame.locator(found.selector).first().elementHandle() : await found.frame.frameElement();
      if (!target) throw new Error("the challenge went away");
      await target.scrollIntoViewIfNeeded().catch(() => {});
      // At 2x: set once loaded (navigation resets it) on a session kept open (detaching drops it), then let layout settle.
      const cdp = await context.newCDPSession(page);
      await emulateScale(cdp, 1280, 800, SCALE);
      await page.waitForTimeout(1500);
      const box = await target.boundingBox();
      if (!box) throw new Error("the challenge has no box");
      // Page.captureScreenshot clips in document coordinates; the box is relative to the viewport.
      const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
      writeFileSync(rawFile(provider), await captureBox(cdp, { ...box, x: box.x + scroll.x, y: box.y + scroll.y }));
      report[provider] = `captured (${found.selector}${found.frame === page.mainFrame() ? "" : ", its frame"})${opened}`;
    } catch (error) {
      report[provider] = `failed: ${(error as Error).message.split("\n")[0]}`;
    } finally {
      await page.close();
    }
  }
  return report;
}
