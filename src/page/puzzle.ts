import { findPuzzleGap, type Pixels } from "../core/puzzle";
import type { AdapterSpec } from "../core/types";
import { isVisible, queryAll } from "./dom";

/** Pixels of an image as the widget loaded it; a tainted canvas (cross-origin) falls back to fetching it. */
async function pixels(img: HTMLImageElement): Promise<Pixels> {
  const read = (source: CanvasImageSource, width: number, height: number) => {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(source, 0, 0);
    return ctx.getImageData(0, 0, width, height);
  };
  try {
    return read(img, img.naturalWidth, img.naturalHeight);
  } catch {
    const bitmap = await createImageBitmap(await (await fetch(img.src)).blob());
    return read(bitmap, bitmap.width, bitmap.height);
  }
}

/**
 * Measure a slide puzzle described by an adapter with `background` and `piece` image targets: how
 * far (CSS px) the handle must move for the piece to sit in its gap, and how sure that is.
 */
export async function measurePuzzle(spec: AdapterSpec): Promise<{ distance: number; margin: number } | null> {
  const find = (id: string) => {
    const target = spec.targets.find((t) => t.id === id);
    return target && queryAll(document, target.selector, !!spec.pierce).find(isVisible);
  };
  const background = find("background");
  const piece = find("piece");
  if (!(background instanceof HTMLImageElement) || !(piece instanceof HTMLImageElement)) return null;
  if (!background.complete || !piece.complete || !background.naturalWidth || !piece.naturalWidth) return null;
  const [bg, pc] = await Promise.all([pixels(background), pixels(piece)]);
  const b = background.getBoundingClientRect();
  const p = piece.getBoundingClientRect();
  // Rendered pixels per image pixel; the piece is drawn at the background's scale.
  const scale = b.width / background.naturalWidth;
  const origin = { x: Math.round((p.x - b.x) / scale), y: Math.round((p.y - b.y) / scale) };
  const gap = findPuzzleGap(bg, pc, origin);
  return { distance: gap.offset * scale, margin: gap.margin };
}
