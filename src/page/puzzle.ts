import { findPuzzleGap, type Pixels } from "../core/puzzle";
import type { AdapterSpec } from "../core/types";
import { isVisible, queryAll } from "./dom";

/** The image a CSS `background-image: url(...)` names, or undefined. */
export function backgroundUrl(backgroundImage: string): string | undefined {
  const match = /url\((['"]?)(.*?)\1\)/.exec(backgroundImage);
  return match?.[2] || undefined;
}

function read(source: CanvasImageSource, width: number, height: number): Pixels {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0);
  return ctx.getImageData(0, 0, width, height);
}

/** An image's pixels from its URL: fetched, so a cross-origin image does not taint the canvas. */
async function fetched(url: string): Promise<Pixels> {
  const bitmap = await createImageBitmap(await (await fetch(url)).blob());
  return read(bitmap, bitmap.width, bitmap.height);
}

/**
 * Pixels of a puzzle part as the widget shows it, at the image's own resolution: an `<img>`, a
 * `<canvas>` (GeeTest, Dingxiang draw into one), or any element with a CSS background image.
 * Null while it has nothing to show yet.
 */
export async function pixelsOf(el: Element): Promise<Pixels | null> {
  if (el instanceof HTMLImageElement) {
    if (!el.complete || !el.naturalWidth) return null;
    try {
      return read(el, el.naturalWidth, el.naturalHeight);
    } catch {
      // Tainted by a cross-origin image: fetch it instead.
      return fetched(el.currentSrc || el.src);
    }
  }
  if (el instanceof HTMLCanvasElement) {
    if (!el.width || !el.height) return null;
    return read(el, el.width, el.height);
  }
  const url = backgroundUrl(getComputedStyle(el).backgroundImage);
  return url ? fetched(url) : null;
}

/** Pixels resampled to `width` × `height`: the size the element is shown at. */
async function resample(pixels: Pixels, width: number, height: number): Promise<Pixels> {
  if (pixels.width === width && pixels.height === height) return pixels;
  const bitmap = await createImageBitmap(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

/**
 * Measure a slide puzzle described by an adapter with `background` and `piece` targets: how far
 * (CSS px) the piece must move to sit in its gap, and how sure that is. Both images are measured
 * as shown (resampled to their rendered size), so widgets that scale the piece unlike the
 * background, stretch an image, or start the piece away from the edge all come out in CSS px.
 */
export async function measurePuzzle(spec: AdapterSpec): Promise<{ distance: number; margin: number } | null> {
  const find = (id: string) => {
    const target = spec.targets.find((t) => t.id === id);
    return target && queryAll(document, target.selector, !!spec.pierce).find(isVisible);
  };
  const background = find("background");
  const piece = find("piece");
  if (!background || !piece) return null;
  const [bg, pc] = await Promise.all([pixelsOf(background), pixelsOf(piece)]);
  if (!bg || !pc) return null;
  const b = background.getBoundingClientRect();
  const p = piece.getBoundingClientRect();
  const [shownBg, shownPiece] = await Promise.all([
    resample(bg, Math.round(b.width), Math.round(b.height)),
    resample(pc, Math.round(p.width), Math.round(p.height)),
  ]);
  const gap = findPuzzleGap(shownBg, shownPiece, { x: Math.round(p.x - b.x), y: Math.round(p.y - b.y) });
  return { distance: gap.offset, margin: gap.margin };
}
