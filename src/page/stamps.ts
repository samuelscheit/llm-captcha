import { countStamps } from "../core/stamps";
import type { AdapterSpec } from "../core/types";
import { isVisible, queryAll } from "./dom";
import { pixelsOf } from "./puzzle";

/** Stamp counts (`stamps`) of the `image` targets, in order; null while one loads or when the picture cannot be learned. */
export async function measureStamps(spec: AdapterSpec): Promise<number[] | null> {
  const selector = spec.targets.find((t) => t.id === "image")?.selector;
  if (!selector || !spec.stamps) return null;
  const images = await Promise.all(queryAll(document, selector, !!spec.pierce).filter(isVisible).map(pixelsOf));
  if (!images.length || images.some((p) => !p)) return null;
  return countStamps(images as NonNullable<(typeof images)[number]>[], spec.stamps);
}
