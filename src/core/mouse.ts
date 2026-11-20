/**
 * Human-like gesture plans in top-level CSS pixels. Pure, so tracks can be reproduced and tested
 * with a seeded random source; the service worker dispatches them through CDP
 * Input.dispatchMouseEvent, which the browser routes to whichever (out-of-process) frame is under
 * the pointer.
 */

export interface Point {
  x: number;
  y: number;
}

export interface MouseStep extends Point {
  type: "mouseMoved" | "mousePressed" | "mouseReleased";
  /** Left button held after this step: 1 while pressed or dragging, 0 otherwise. */
  buttons: 0 | 1;
  /** Pause after this step. */
  delayMs: number;
}

export type RandomSource = () => number;

export const between = (random: RandomSource, min: number, max: number) => min + (max - min) * random();
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Deterministic random source (mulberry32) for tests and replays. */
export function seeded(seed: number): RandomSource {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smoothstep easing: slow start, fast middle, slow end, as a hand moves toward a target. */
const smoothstep = (p: number) => p * p * (3 - 2 * p);
/** Minimum-jerk profile: the velocity curve of a deliberate human reach. */
const minimumJerk = (p: number) => p ** 3 * (10 - 15 * p + 6 * p * p);

/** Hover from `from` (or a nearby point) onto `to`, ending exactly on it. */
export function approach(to: Point, random: RandomSource, from?: Point): MouseStep[] {
  const start = from ?? { x: Math.max(1, to.x - between(random, 70, 105)), y: Math.max(1, to.y - between(random, 25, 50)) };
  const distance = Math.hypot(to.x - start.x, to.y - start.y);
  const steps = Math.round(clamp(distance / 25, 8, 30));
  const result: MouseStep[] = [];
  for (let step = 1; step <= steps; step++) {
    const eased = smoothstep(step / steps);
    const last = step === steps;
    result.push({
      type: "mouseMoved",
      x: last ? to.x : start.x + (to.x - start.x) * eased + between(random, -2, 2),
      y: last ? to.y : start.y + (to.y - start.y) * eased + between(random, -2, 2),
      buttons: 0,
      delayMs: between(random, 8, 20),
    });
  }
  return result;
}

/** Approach, short pause, press, release. `spread` jitters the click point inside the target. */
export function clickSteps(at: Point, random: RandomSource, from?: Point, spread = 2): MouseStep[] {
  const point = { x: at.x + between(random, -spread, spread), y: at.y + between(random, -spread, spread) };
  const steps = approach(point, random, from);
  steps[steps.length - 1]!.delayMs = between(random, 40, 120);
  return [
    ...steps,
    { type: "mousePressed", ...point, buttons: 1, delayMs: between(random, 50, 110) },
    { type: "mouseReleased", ...point, buttons: 0, delayMs: 0 },
  ];
}

/**
 * Press at `from`, move to `to` with a minimum-jerk profile and slight sideways wander, overshoot
 * along the drag direction by a few pixels, settle back, pause, release on `to`. Progress along the
 * direction never decreases before the overshoot: track-scoring sliders refuse a pointer that
 * jitters back.
 */
export function dragSteps(from: Point, to: Point, random: RandomSource, hoverFrom?: Point): MouseStep[] {
  const steps = approach(from, random, hoverFrom);
  steps[steps.length - 1]!.delayMs = between(random, 80, 200);
  steps.push({ type: "mousePressed", ...from, buttons: 1, delayMs: between(random, 90, 190) });

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  // Along the drag (u) and across it (v).
  const u = { x: dx / length, y: dy / length };
  const v = { x: -u.y, y: u.x };
  const overshoot = Math.min(between(random, 3, 9), length / 4);
  const peakS = length + overshoot;
  const peak = { x: from.x + u.x * peakS, y: from.y + u.y * peakS };
  const moves = Math.round(clamp(length / 8, 20, 45));
  const duration = between(random, 500, 1100);
  let s = 0;
  let w = 0;
  for (let move = 1; move <= moves; move++) {
    const last = move === moves;
    s = last ? peakS : clamp(peakS * minimumJerk(move / moves) + between(random, -0.6, 0.6), s, peakS);
    w = last ? 0 : clamp(w + between(random, -0.8, 0.8), -2.5, 2.5);
    steps.push({
      type: "mouseMoved",
      x: from.x + u.x * s + v.x * w,
      y: from.y + u.y * s + v.y * w,
      buttons: 1,
      delayMs: (duration / moves) * between(random, 0.7, 1.3),
    });
  }
  const settles = Math.round(between(random, 2, 4));
  for (let settle = 1; settle <= settles; settle++) {
    const p = settle / settles;
    steps.push({ type: "mouseMoved", x: peak.x + (to.x - peak.x) * p, y: peak.y + (to.y - peak.y) * p, buttons: 1, delayMs: between(random, 25, 60) });
  }
  steps[steps.length - 1]!.delayMs = between(random, 60, 150);
  steps.push({ type: "mouseReleased", ...to, buttons: 0, delayMs: 0 });
  return steps;
}
