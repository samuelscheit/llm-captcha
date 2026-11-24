/**
 * What every figure of `bun run docs` shares: fixture and PNG I/O, the visual language (the
 * benchmark site's palette), and rendering an HTML figure to a PNG in local Chrome at 2x.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import type { CDPSession, Page } from "patchright";
import type { Pixels } from "../../core/puzzle";

export const ROOT = path.resolve(import.meta.dirname, "../../..");
export const FIXTURES = path.join(ROOT, "fixtures");
export const OUT = path.join(ROOT, "docs/img");

export const fixturePath = (...parts: string[]) => path.join(FIXTURES, ...parts);
export const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;

/** RGBA pixels of a PNG (file or bytes), whatever its colour type. */
export function readPng(file: string | Buffer): Pixels {
  const png = PNG.sync.read(typeof file === "string" ? readFileSync(file) : file);
  return { width: png.width, height: png.height, data: png.data };
}

export function encodePng(p: Pixels): Buffer {
  const png = new PNG({ width: p.width, height: p.height });
  png.data = Buffer.from(p.data);
  return PNG.sync.write(png);
}

export const dataUrl = (png: Buffer) => `data:image/png;base64,${png.toString("base64")}`;
export const fileUrl = (file: string) => dataUrl(readFileSync(file));

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The benchmark site's palette (src/tools/benchmark/site.ts), for figures that sit in the README. */
export const COLOR = {
  surface: "#fff",
  bg: "#f6f6f4",
  line: "#e3e2de",
  text: "#1b1b1a",
  muted: "#6b6a66",
  accent: "#2f5bea",
  accentBg: "#e8eefc",
  good: "#1a7f4b",
  goodBg: "#e7f4ec",
  bad: "#c53030",
  warn: "#b7791f",
} as const;

/** Colours of successive passes, peels, steps: distinct on white, accent first. */
export const SERIES = [COLOR.accent, "#d9480f", COLOR.good, "#8b3fd9", "#0b8ea1", COLOR.bad];

const FONT = 'system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif';

/** The page a figure is drawn in: a card on a transparent background (rounded corners stay transparent). */
function page(body: string, css: string, width: number): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;background:transparent}
body{font:14px/1.45 ${FONT};color:${COLOR.text};-webkit-font-smoothing:antialiased}
#figure{width:${width}px;background:${COLOR.surface};border:1px solid ${COLOR.line};border-radius:12px;padding:28px 32px 26px}
h1{font-size:19px;letter-spacing:-.01em;margin:0 0 4px}
.lede{color:${COLOR.muted};margin:0 0 22px;max-width:${width - 120}px}
.step{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:650;color:${COLOR.muted};text-transform:uppercase;letter-spacing:.05em;margin:0 0 8px}
.step b{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;background:${COLOR.accentBg};color:${COLOR.accent};font-size:11px;letter-spacing:0}
.cap{color:${COLOR.muted};font-size:12.5px;margin:8px 0 0}
.shot{display:block;border:1px solid ${COLOR.line};border-radius:8px;background:${COLOR.bg}}
.px{image-rendering:pixelated}
.mono{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:12.5px}
.chip{display:inline-block;padding:2px 8px;border-radius:999px;background:${COLOR.accentBg};color:${COLOR.accent};font-weight:600;margin:0 4px 4px 0}
.good{color:${COLOR.good}}.bad{color:${COLOR.bad}}
.foot{color:${COLOR.muted};font-size:12px;margin:18px 0 0;padding-top:12px;border-top:1px solid ${COLOR.line}}
${css}
</style></head><body><div id="figure">${body}</div></body></html>`;
}

/** Shrink a PNG losslessly-looking (pngquant, when installed; the figures are flat colours and screenshots). */
export function optimizePng(file: string): void {
  try {
    // No dithering: the figures are flat colours and photos at 2x, where dither noise only costs bytes.
    execFileSync("pngquant", ["--force", "--skip-if-larger", "--quality", "65-95", "--nofs", "--speed", "1", "--strip", "--output", file, "--", file], { stdio: "ignore" });
  } catch (error) {
    // 99: quality not reached, 98: not smaller; both keep the original. Missing pngquant: keep it too.
    const status = (error as { status?: number }).status;
    if (status !== 98 && status !== 99 && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/** The part of `p` inside `box`. */
export function crop(p: Pixels, box: { x: number; y: number; width: number; height: number }): Pixels {
  const data = new Uint8ClampedArray(box.width * box.height * 4);
  for (let y = 0; y < box.height; y++) data.set(p.data.subarray(((box.y + y) * p.width + box.x) * 4, ((box.y + y) * p.width + box.x + box.width) * 4), y * box.width * 4);
  return { width: box.width, height: box.height, data };
}

/** The box of everything that differs from the colour at the top-left corner (the margin around a widget). */
export function contentBox(p: Pixels, tolerance = 10): { x: number; y: number; width: number; height: number } {
  const corner = p.data.subarray(0, 4);
  let [minX, minY, maxX, maxY] = [p.width, p.height, -1, -1];
  for (let y = 0; y < p.height; y++) {
    for (let x = 0; x < p.width; x++) {
      const i = (y * p.width + x) * 4;
      let differs = false;
      for (let c = 0; c < 4; c++) if (Math.abs(p.data[i + c]! - corner[c]!) > tolerance) differs = true;
      if (!differs) continue;
      [minX, minY, maxX, maxY] = [Math.min(minX, x), Math.min(minY, y), Math.max(maxX, x), Math.max(maxY, y)];
    }
  }
  return maxX < 0 ? { x: 0, y: 0, width: p.width, height: p.height } : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

type Box = { x: number; y: number; width: number; height: number };

/**
 * Emulate `scale` device pixels per CSS pixel on `cdp`'s page. The session must stay attached:
 * Chrome drops a session's emulation when it detaches.
 */
export async function emulateScale(cdp: CDPSession, width: number, height: number, scale: number): Promise<void> {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
}

/**
 * A screenshot of `box` (CSS px of the page) at the emulated scale. Playwright's own screenshots
 * scale by the context's device factor (1 here), so they would come out at 1x.
 */
export async function captureBox(cdp: CDPSession, box: Box, transparent = false): Promise<Buffer> {
  if (transparent) await cdp.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", clip: { ...box, scale: 1 }, captureBeyondViewport: true, fromSurface: true });
  return Buffer.from(data, "base64");
}

/** Renders HTML figures to PNG at device scale `scale`, in one tab of the docs browser. */
export class Renderer {
  private cdp?: CDPSession;

  constructor(private readonly tab: Page) {}

  /** A card figure `width` CSS px wide, saved as docs/img/<name> at 2x. */
  async figure(name: string, body: string, options: { width: number; css?: string }): Promise<string> {
    return this.shoot(name, page(body, options.css ?? "", options.width), "#figure", options.width + 40, 2);
  }

  /**
   * Save an SVG figure as docs/img/<name>, only if it is well-formed XML: GitHub shows nothing for
   * an SVG with an error, while a browser shows it up to the error. Checked by Chrome's strict XML
   * parser (happy-dom's DOMParser accepts a bare `&`).
   */
  async writeSvg(name: string, svg: string): Promise<string> {
    const error = await this.tab.evaluate((source) => {
      const doc = new DOMParser().parseFromString(source, "image/svg+xml");
      return doc.querySelector("parsererror")?.textContent ?? null;
    }, svg);
    if (error !== null) throw new Error(`${name} is not well-formed XML: ${error}`);
    const file = path.join(OUT, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, svg);
    return file;
  }

  /** A bare page; `selector` is the element saved as docs/img/<name>. */
  async shoot(name: string, html: string, selector: string, viewportWidth: number, scale: number): Promise<string> {
    const file = path.join(OUT, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, await this.element(html, selector, viewportWidth, scale));
    optimizePng(file);
    return file;
  }

  /** Screenshot of the first `selector` in `html`. Pages that load from the network get a few seconds, not their `load`. */
  async element(html: string, selector: string, viewportWidth: number, scale: number): Promise<Buffer> {
    this.cdp ??= await this.tab.context().newCDPSession(this.tab);
    await emulateScale(this.cdp, viewportWidth, 800, scale);
    await this.tab.setContent(html, { waitUntil: "domcontentloaded" });
    await this.tab.waitForLoadState("load", { timeout: 5000 }).catch(() => {});
    await this.tab.evaluate(() => document.fonts.ready);
    const box = await this.tab.locator(selector).first().boundingBox();
    if (!box) throw new Error(`Nothing visible matches ${selector}.`);
    return captureBox(this.cdp, box, true);
  }
}
