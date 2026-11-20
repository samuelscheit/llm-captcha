/**
 * Carousels (Arkose's "use the arrows" games): the answer is one of a few options the widget shows
 * one at a time. Asking the model per option would cost a round each and never compare them, so
 * the engine pages through all options, lays their screenshots out as one labeled contact sheet
 * (o1..oN), lets the model pick one, then goes to it and submits.
 */
import type { Driver } from "../driver";
import { center } from "../geometry";
import { clickSteps, type Point, type RandomSource } from "../mouse";
import type { AdapterSpec, ChallengeView, Rect, Target } from "../types";

const SHEET_GAP = 12;

/** The option dots of a carousel view, in order (`<options>1..N`). */
export function optionsOf(view: ChallengeView, spec: AdapterSpec): Target[] {
  const prefix = spec.carousel!.options;
  return view.targets.filter((t) => new RegExp(`^${prefix}\\d+$`).test(t.id)).sort((a, b) => Number(a.id.slice(prefix.length)) - Number(b.id.slice(prefix.length)));
}

/** Index of the option shown now, from the dot marked selected (0 when none is). */
export function currentOption(view: ChallengeView, spec: AdapterSpec): number {
  return Math.max(0, optionsOf(view, spec).findIndex((t) => t.selected));
}

/** Where each of `n` same-size shots goes on the sheet: rows of up to 3. */
export function sheetLayout(n: number, width: number, height: number): { width: number; height: number; cells: Rect[] } {
  const columns = Math.min(n, 3);
  const rows = Math.ceil(n / columns);
  const cells = Array.from({ length: n }, (_, i) => ({ x: (i % columns) * (width + SHEET_GAP), y: Math.floor(i / columns) * (height + SHEET_GAP), width, height }));
  return { width: columns * width + (columns - 1) * SHEET_GAP, height: rows * height + (rows - 1) * SHEET_GAP, cells };
}

/** The view the model answers: the sheet, with one target per option. */
export function sheetView(view: ChallengeView, sheet: { width: number; height: number; cells: Rect[] }): ChallengeView {
  const n = sheet.cells.length;
  return {
    ...view,
    kind: "select",
    region: { x: 0, y: 0, width: sheet.width, height: sheet.height },
    instruction: `${view.instruction} [The challenge shown once per option, o1 to o${n}. Click exactly the one option that answers it; it is submitted for you.]`,
    errors: view.errors,
    targets: sheet.cells.map((rect, i) => ({ id: `o${i + 1}`, rect })),
  };
}

async function click(driver: Driver, target: Rect, random: RandomSource, from?: Point): Promise<Point> {
  const steps = clickSteps(center(target), random, from, Math.min(target.width, target.height) / 6);
  await driver.input.mouse(steps);
  return steps.at(-1)!;
}

/**
 * Show every option once, from the current one on, and screenshot each. `shoot` captures the
 * challenge as it is; `rescan` finds it again after a click. Ends where it started when the
 * carousel wraps around.
 */
export async function browse(
  driver: Driver,
  view: ChallengeView,
  spec: AdapterSpec,
  shoot: (view: ChallengeView) => Promise<string>,
  rescan: () => Promise<ChallengeView | undefined>,
  random: RandomSource,
  sleep: (ms: number) => Promise<void>,
  from?: Point,
): Promise<{ shots: string[]; start: number; pointer?: Point }> {
  const n = optionsOf(view, spec).length;
  const start = currentOption(view, spec);
  const shots = new Array<string>(n);
  let pointer = from;
  let now: ChallengeView = view;
  for (let step = 0; step < n; step++) {
    shots[(start + step) % n] = await shoot(now);
    if (step === n - 1) break;
    const next = now.targets.find((t) => t.id === spec.carousel!.next);
    if (!next) break;
    pointer = await click(driver, next.rect, random, pointer);
    await sleep(between(random, 600, 900));
    now = (await rescan()) ?? now;
  }
  return { shots, start, pointer };
}

const between = (random: RandomSource, min: number, max: number) => min + (max - min) * random();

/** Go to option `choice` (0-based) with the next button and submit it. */
export async function answer(
  driver: Driver,
  spec: AdapterSpec,
  choice: number,
  rescan: () => Promise<ChallengeView | undefined>,
  random: RandomSource,
  sleep: (ms: number) => Promise<void>,
  from?: Point,
): Promise<Point | undefined> {
  let pointer = from;
  let view = await rescan();
  for (let guard = 0; view && currentOption(view, spec) !== choice && guard < optionsOf(view, spec).length; guard++) {
    const next = view.targets.find((t) => t.id === spec.carousel!.next);
    if (!next) break;
    pointer = await click(driver, next.rect, random, pointer);
    await sleep(between(random, 500, 800));
    view = await rescan();
  }
  const submit = view?.targets.find((t) => t.id === spec.carousel!.submit);
  if (submit) pointer = await click(driver, submit.rect, random, pointer);
  return pointer;
}
