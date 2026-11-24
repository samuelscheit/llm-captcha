/**
 * Press & Hold (HUMAN/PerimeterX): press the handle and keep the button down, moving the pointer
 * slightly like a resting hand, until the challenge leaves `pending` (its `solved` signal, or it
 * goes away). Measured on the real widget: the fill takes 3–5 s, a press right after the widget
 * appears does nothing (it is not armed yet), and a perfectly still pointer is suspicious.
 */
import type { Driver } from "../driver";
import { center } from "../geometry";
import { approach, between, type MouseStep, type Point, type RandomSource } from "../mouse";
import type { ChallengeView, Rect } from "../types";

/** The widget arms itself a few seconds after it appears; pressing earlier does nothing. */
export const HOLD_READY_MS: [number, number] = [2500, 4000];
const MAX_HOLD_MS = 15_000;
/** If the progress fill has not grown by then, the widget was not armed: let go and retry later. */
const NOT_ARMED_MS = 1500;
/** A resting hand moves by up to this much while it holds. */
export const HOLD_JITTER_PX = 3;

export type HoldOutcome = "released" | "not-armed" | "timeout";

/** The approach to a spot near the handle's centre, a short pause, and the press. */
export function holdPress(handle: Rect, random: RandomSource, from?: Point): { at: Point; steps: MouseStep[] } {
  const at = { x: center(handle).x + between(random, -10, 10), y: center(handle).y + between(random, -5, 5) };
  const steps = approach(at, random, from);
  steps[steps.length - 1]!.delayMs = between(random, 150, 400);
  return { at, steps: [...steps, { type: "mousePressed", ...at, buttons: 1, delayMs: 0 }] };
}

/** One move of the resting hand around the press: how long to wait first, and where it goes. */
export function holdTremor(press: Point, random: RandomSource): { delayMs: number; at: Point } {
  const delayMs = between(random, 120, 260);
  return { delayMs, at: { x: press.x + between(random, -HOLD_JITTER_PX, HOLD_JITTER_PX), y: press.y + between(random, -HOLD_JITTER_PX, HOLD_JITTER_PX) } };
}

/** A whole hold of about `ms` as one track (press, tremors, release), for illustrations. */
export function holdTrack(handle: Rect, ms: number, random: RandomSource, from?: Point): MouseStep[] {
  const { at: press, steps } = holdPress(handle, random, from);
  let at = press;
  for (let held = 0; held < ms; ) {
    const tremor = holdTremor(press, random);
    steps.at(-1)!.delayMs = tremor.delayMs;
    held += tremor.delayMs;
    at = tremor.at;
    steps.push({ type: "mouseMoved", ...at, buttons: 1, delayMs: 0 });
  }
  return [...steps, { type: "mouseReleased", ...at, buttons: 0, delayMs: 0 }];
}

/**
 * One hold. `rescan` finds this challenge again (undefined once it is gone); the hold ends when it
 * is no longer pending, when its `progress` target stops at zero, or after MAX_HOLD_MS.
 */
export async function hold(
  driver: Driver,
  view: ChallengeView,
  rescan: () => Promise<ChallengeView | undefined>,
  random: RandomSource,
  sleep: (ms: number) => Promise<void>,
  from?: Point,
): Promise<{ outcome: HoldOutcome; pointer: Point }> {
  const { at: press, steps } = holdPress(view.targets.find((t) => t.id === "handle")!.rect, random, from);
  await driver.input.mouse(steps);

  const progressOf = (v: ChallengeView | undefined) => v?.targets.find((t) => t.id === "progress")?.rect.width;
  const startWidth = progressOf(view) ?? 0;
  const started = Date.now();
  let armed = progressOf(view) === undefined;
  let outcome: HoldOutcome = "timeout";
  let at = press;
  while (Date.now() - started < MAX_HOLD_MS) {
    const tremor = holdTremor(press, random);
    await sleep(tremor.delayMs);
    at = tremor.at;
    await driver.input.mouse([{ type: "mouseMoved", ...at, buttons: 1, delayMs: 0 } satisfies MouseStep]);
    const now = await rescan();
    if (!now || now.status !== "pending") {
      outcome = "released";
      break;
    }
    const width = progressOf(now);
    if (width !== undefined && width > startWidth + 2) armed = true;
    if (!armed && Date.now() - started > NOT_ARMED_MS) {
      outcome = "not-armed";
      break;
    }
  }
  await driver.input.mouse([{ type: "mouseReleased", ...at, buttons: 0, delayMs: 0 }]);
  return { outcome, pointer: at };
}
