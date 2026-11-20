import type { ImageLabel, Motion } from "../core/driver";
import { fromBase64, toBase64 } from "../core/geometry";
import type { Rect } from "../core/types";

/**
 * Image work on PNG base64 strings with OffscreenCanvas. Runs wherever that exists: the extension
 * service worker, content scripts and CDP isolated worlds.
 */

const decode = async (png: string) => createImageBitmap(new Blob([fromBase64(png)], { type: "image/png" }));

async function encode(canvas: OffscreenCanvas): Promise<string> {
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return toBase64(new Uint8Array(await blob.arrayBuffer()));
}

/** Cut `rect` (source pixels) out of a screenshot and scale it to width × height. */
export async function crop(request: { image: string; rect: Rect; width: number; height: number }): Promise<string> {
  const bitmap = await decode(request.image);
  const canvas = new OffscreenCanvas(request.width, request.height);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  const { x, y, width, height } = request.rect;
  ctx.drawImage(bitmap, x, y, width, height, 0, 0, request.width, request.height);
  return encode(canvas);
}

/** Draw images into one canvas, each into its rect, on white (a contact sheet). */
export async function compose(request: { width: number; height: number; parts: ({ image: string } & Rect)[] }): Promise<string> {
  const canvas = new OffscreenCanvas(request.width, request.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, request.width, request.height);
  for (const part of request.parts) ctx.drawImage(await decode(part.image), part.x, part.y, part.width, part.height);
  return encode(canvas);
}

const COLORS = { target: "rgba(255, 0, 170, 0.8)", motion: "rgba(0, 200, 255, 0.95)" };

/** Draw each label as an outline of its rect with a small dark id tag at its top-left corner. */
export async function label(request: { image: string; labels: ImageLabel[] }): Promise<string> {
  const bitmap = await decode(request.image);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  ctx.font = "bold 12px system-ui, sans-serif";
  ctx.textBaseline = "top";
  for (const { text, rect, kind } of request.labels) {
    ctx.strokeStyle = COLORS[kind ?? "target"];
    ctx.lineWidth = kind === "motion" ? 2 : 1;
    ctx.setLineDash(kind === "motion" ? [5, 3] : []);
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
    const w = ctx.measureText(text).width + 6;
    const x = Math.max(0, Math.min(rect.x + 1, canvas.width - w));
    const y = Math.max(0, Math.min(rect.y + 1, canvas.height - 16));
    ctx.fillStyle = kind === "motion" ? "rgba(0, 70, 110, 0.9)" : "rgba(20, 20, 20, 0.85)";
    ctx.fillRect(x, y, w, 16);
    ctx.fillStyle = "#fff";
    ctx.fillText(text, x + 3, y + 2);
  }
  return encode(canvas);
}

const CELL = 8;
/** Mean absolute luminance difference (0–255) above which a cell counts as changed. */
const CELL_THRESHOLD = 10;
const MIN_CELLS = 2;
const MAX_BOXES = 8;

/** Luminance per CELL×CELL cell. */
async function cells(png: string): Promise<{ cols: number; rows: number; values: Float32Array }> {
  const bitmap = await decode(png);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const cols = Math.ceil(bitmap.width / CELL);
  const rows = Math.ceil(bitmap.height / CELL);
  const sums = new Float32Array(cols * rows);
  const counts = new Uint16Array(cols * rows);
  for (let y = 0; y < bitmap.height; y++) {
    for (let x = 0; x < bitmap.width; x++) {
      const i = (y * bitmap.width + x) * 4;
      const cell = Math.floor(y / CELL) * cols + Math.floor(x / CELL);
      sums[cell]! += 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
      counts[cell]!++;
    }
  }
  for (let c = 0; c < sums.length; c++) sums[c]! /= counts[c]!;
  return { cols, rows, values: sums };
}

/**
 * What moved across a burst of same-size frames: cells whose luminance changed between any two
 * consecutive frames, grouped into 8-connected components, as boxes in image pixels.
 */
export async function motion(request: { frames: string[] }): Promise<Motion> {
  if (request.frames.length < 2) return { boxes: [], changed: 0 };
  const grids = await Promise.all(request.frames.map(cells));
  const { cols, rows } = grids[0]!;
  const moving = new Uint8Array(cols * rows);
  for (let f = 1; f < grids.length; f++) {
    const a = grids[f - 1]!.values;
    const b = grids[f]!.values;
    for (let c = 0; c < moving.length; c++) if (Math.abs(a[c]! - b[c]!) > CELL_THRESHOLD) moving[c] = 1;
  }
  const seen = new Uint8Array(moving.length);
  const boxes: (Rect & { cells: number })[] = [];
  for (let start = 0; start < moving.length; start++) {
    if (!moving[start] || seen[start]) continue;
    let [minX, minY, maxX, maxY, count] = [cols, rows, 0, 0, 0];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      const cx = c % cols;
      const cy = Math.floor(c / cols);
      [minX, minY, maxX, maxY, count] = [Math.min(minX, cx), Math.min(minY, cy), Math.max(maxX, cx), Math.max(maxY, cy), count + 1];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          const n = ny * cols + nx;
          if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && moving[n] && !seen[n]) {
            seen[n] = 1;
            stack.push(n);
          }
        }
      }
    }
    if (count >= MIN_CELLS) boxes.push({ x: minX * CELL, y: minY * CELL, width: (maxX - minX + 1) * CELL, height: (maxY - minY + 1) * CELL, cells: count });
  }
  const changed = moving.reduce((n, m) => n + m, 0) / moving.length;
  const bitmap = await decode(request.frames[0]!);
  return {
    boxes: boxes
      .sort((a, b) => b.cells - a.cells)
      .slice(0, MAX_BOXES)
      // Edge cells can reach past the image.
      .map(({ x, y, width, height }) => ({ x, y, width: Math.min(width, bitmap.width - x), height: Math.min(height, bitmap.height - y) })),
    changed,
  };
}
