import { findGridShift, type GridShift } from "../core/shift";
import type { AdapterSpec } from "../core/types";
import { isVisible, queryAll } from "./dom";
import { pixelsOf, resample } from "./puzzle";

/**
 * Measure a shifted grid (`shiftedGrid`): the root is the reference image, the `challenge` target
 * the rolled and noised copy. Both are compared at the reference's own resolution. Null while
 * either has not loaded.
 */
export async function measureGridShift(spec: AdapterSpec): Promise<GridShift | null> {
  const pierce = !!spec.pierce;
  const selector = spec.targets.find((t) => t.id === "challenge")?.selector;
  const reference = queryAll(document, spec.root, pierce).find(isVisible);
  const challenge = selector && queryAll(document, selector, pierce).find(isVisible);
  if (!reference || !challenge || !spec.shiftedGrid) return null;
  const [ref, ch] = await Promise.all([pixelsOf(reference), pixelsOf(challenge)]);
  if (!ref || !ch) return null;
  return findGridShift(ref, await resample(ch, ref.width, ref.height), spec.shiftedGrid);
}
