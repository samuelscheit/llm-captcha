import type { LanguageModel } from "ai";
import type { Driver, ImageTools, Motion } from "./driver";
import { center, contains, intersects } from "./geometry";
import { between, clickSteps, dragSteps, type Point, type RandomSource } from "./mouse";
import { MIN_MARGIN } from "./puzzle";
import { AnswerError, answerHelp, parseAnswer } from "./answer";
import { sanitize } from "./solver";
import type { AssistRequest } from "../page/assist";
import type { ImageFrame } from "./prompt";
import { decide } from "./solver";
import type { Action, AdapterSpec, ChallengeView, Decision, HistoryEntry, PageState, Rect, RoundRecord } from "./types";

export interface EngineOptions {
  adapters: AdapterSpec[];
  /**
   * Needed for every challenge beyond a checkbox. The first is used; a model call that fails
   * (provider down, quota, refusal to answer in the schema) moves on to the next.
   */
  models?: LanguageModel[];
  /** Model rounds before giving up. */
  maxRounds?: number;
  /** Whole session, including waits for the vendor's verdict. */
  timeoutMs?: number;
  random?: RandomSource;
  signal?: AbortSignal;
  /** Every model round, with the screenshot, e.g. to save it as a fixture. */
  onRound?: (record: RoundRecord) => void;
}

export interface SolveResult {
  /** idle: no challenge was found. */
  state: Exclude<PageState, "solving">;
  detail: string;
  rounds: RoundRecord[];
  /** On failure: the last challenge's frame as HTML, for fixing its adapter. */
  snapshot?: { adapter: string; html: string };
}

const DEFAULT_RETRY_MS = 5000;
export const FRAME_INTERVAL_MS = 300;
/** In an animated challenge, more of the region changing than this is a transition, not the animation. */
const TRANSITION = 0.5;
/** Unsettled checks in a row after which the model is asked anyway (a widget that never stops moving). */
const MAX_UNSETTLED = 8;
/** Screenshots smaller than this (longest side, CSS px) are upscaled for the model. */
const SMALL_REGION = 300;
const HISTORY_ROUNDS = 3;

/** Empty scans in a row, after a challenge was seen, before it counts as gone (frames reload). */
const EMPTY_SCANS_TO_FINISH = 3;
/** Reveal attempts before a challenge that does not fit the viewport is solved as it is. */
const MAX_REVEALS = 3;
/** A region that moved more than this (CSS px) while the model thought makes its answer stale. */
const MAX_DRIFT = 4;
/** Rejected rounds in a row on one puzzle before asking the widget for a new one. */
const REJECTIONS_BEFORE_RELOAD = 2;
/** Target ids that load a new puzzle. */
const RELOAD_TARGETS = ["reload", "refresh"];

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Settle `promise` or reject when `signal` aborts (CDP calls cannot be cancelled themselves). */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => (signal.removeEventListener("abort", onAbort), resolve(value)),
      (error) => (signal.removeEventListener("abort", onAbort), reject(error)),
    );
  });
}

const drift = (a: Rect, b: Rect) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.width - b.width), Math.abs(a.height - b.height));

const keyOf = (v: ChallengeView) => `${v.frame ?? ""}|${v.adapter}`;

/** Which challenge to work on: an open challenge popup beats the checkbox that opened it. */
export function pickChallenge(views: ChallengeView[]): ChallengeView | undefined {
  const pending = views.filter((v) => v.visible && v.status === "pending");
  return pending.find((v) => v.kind !== "checkbox") ?? pending[0];
}

/** Image size and scale for a region: small ones (text captchas) are doubled. */
export function imageFrame(region: Rect): ImageFrame {
  const scale = Math.max(region.width, region.height) < SMALL_REGION ? 2 : 1;
  return { width: Math.round(region.width * scale), height: Math.round(region.height * scale), scale };
}

/** Labels for every target inside the region, in image pixels. Text challenges stay clean. */
export function labelsOf(view: ChallengeView, frame: ImageFrame) {
  if (view.kind === "text") return [];
  return view.targets
    .filter((t) => intersects(t.rect, view.region))
    .map((t) => ({
      text: t.id,
      rect: {
        x: (t.rect.x - view.region.x) * frame.scale,
        y: (t.rect.y - view.region.y) * frame.scale,
        width: t.rect.width * frame.scale,
        height: t.rect.height * frame.scale,
      },
    }));
}

export const isAnimated = (view: ChallengeView, spec?: AdapterSpec) => spec?.animated ?? view.kind === "point";
/** Animated challenges need frames to show the motion; the others two, to tell whether they settled. */
export const framesFor = (view: ChallengeView, spec?: AdapterSpec) => (isAnimated(view, spec) ? 3 : 2);

/** A burst of region screenshots at model resolution, FRAME_INTERVAL_MS apart. */
export async function capture(driver: Driver, view: ChallengeView, count: number, signal: AbortSignal): Promise<string[]> {
  const frame = imageFrame(view.region);
  const frames: string[] = [];
  for (let i = 0; i < count; i++) {
    if (i) await sleep(FRAME_INTERVAL_MS, signal);
    // A background tab's capture can hang.
    const shot = await abortable(driver.input.screenshot(), signal);
    const { x, y, width, height } = view.region;
    const rect = { x: x * shot.scale, y: y * shot.scale, width: width * shot.scale, height: height * shot.scale };
    frames.push(await driver.images.crop({ image: shot.image, rect, width: frame.width, height: frame.height }));
  }
  return frames;
}

export interface Thought {
  decision: Decision;
  frame: ImageFrame;
  /** The labeled current frame. */
  image: string;
  motion: Motion;
  /** True when the challenge had not settled and the model was not asked. */
  skipped: boolean;
}

/** Who answers a round: a model, or (assist mode) whoever drives the browser, through `ask`. */
export type Solver = { model: LanguageModel } | { ask: (request: Omit<AssistRequest, "side">) => Promise<string> };

/** Assist mode answers parsed into a decision; an answer that does not parse is asked again with the reason. */
async function askAnswer(ask: (request: Omit<AssistRequest, "side">) => Promise<string>, view: ChallengeView, image: string, frame: ImageFrame, signal?: AbortSignal): Promise<Decision> {
  let error: string | undefined;
  for (;;) {
    const answer = await (signal ? abortable(ask({ instruction: view.instruction, image, help: answerHelp(view, frame), error }), signal) : ask({ instruction: view.instruction, image, help: answerHelp(view, frame), error }));
    try {
      return sanitize(parseAnswer(answer, view), view, frame);
    } catch (e) {
      if (!(e instanceof AnswerError)) throw e;
      error = e.message;
    }
  }
}

/**
 * Label the frames, find what moved and ask the model (or the person or agent, in assist mode),
 * unless the challenge is still changing. Shared by live solving and fixture replays. `force` asks
 * even if it is not settled.
 */
export async function think(
  images: ImageTools,
  solver: Solver,
  view: ChallengeView,
  frames: string[],
  history: HistoryEntry[],
  options: { animated: boolean; force?: boolean; signal?: AbortSignal },
): Promise<Thought> {
  const frame = imageFrame(view.region);
  const current = frames.at(-1)!;
  const motion = frames.length > 1 ? await images.motion({ frames }) : { boxes: [], changed: 0 };
  const settled = options.animated ? motion.changed <= TRANSITION : motion.boxes.length === 0;
  if (!settled && !options.force) {
    const reasoning = `${Math.round(motion.changed * 100)}% of the challenge changed between frames: it is still loading or switching.`;
    return { decision: { reasoning, actions: [WAIT] }, frame, image: current, motion, skipped: true };
  }
  const moving = options.animated && motion.boxes.length > 0;
  const labels = [...labelsOf(view, frame), ...(moving ? motion.boxes : []).map((rect, i) => ({ text: `m${i + 1}`, rect, kind: "motion" as const }))];
  const image = await images.label({ image: current, labels });
  if ("ask" in solver) return { decision: await askAnswer(solver.ask, view, image, frame, options.signal), frame, image, motion, skipped: false };
  const decision = await decide(
    solver.model,
    {
      view,
      history,
      images: moving ? [...frames.slice(0, -1), image] : [image],
      frame,
      motion: moving ? { frames: frames.length, intervalMs: FRAME_INTERVAL_MS, boxes: motion.boxes } : undefined,
    },
    options.signal,
  );
  return { decision, frame, image, motion, skipped: false };
}

const WAIT: Action = { kind: "wait", target: null, text: null, x: null, y: null, toX: null, toY: null };

/**
 * Solve every challenge on the page until none is left, the round budget is spent, or a challenge
 * reports it is blocked. Publishes `solving`, then `solved` or `failed`, on the top document.
 */
export async function solve(driver: Driver, options: EngineOptions): Promise<SolveResult> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 180_000);
  // Every wait, screenshot and model call ends at the deadline, not only the loop.
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const rounds: RoundRecord[] = [];
  const session: Session = { announced: false };
  const finish = async (state: SolveResult["state"], detail: string, announced: boolean): Promise<SolveResult> => {
    if (announced || state === "failed") await driver.publish(state, detail);
    const result: SolveResult = { state, detail, rounds };
    if (state === "failed" && session.last) {
      const html = await driver.snapshot(session.last).catch(() => "");
      if (html) result.snapshot = { adapter: session.last.adapter, html };
    }
    return result;
  };
  try {
    return await solveLoop(driver, options, signal, rounds, session, finish);
  } catch (error) {
    if (!timeout.aborted) throw error;
    return finish("failed", "timed out", session.announced);
  }
}

interface Session {
  announced: boolean;
  /** The challenge worked on last, for the failure snapshot. */
  last?: ChallengeView;
}

async function solveLoop(
  driver: Driver,
  options: EngineOptions,
  signal: AbortSignal,
  rounds: RoundRecord[],
  session: Session,
  finishWith: (state: SolveResult["state"], detail: string, announced: boolean) => Promise<SolveResult>,
): Promise<SolveResult> {
  const { adapters, models = [], random = Math.random } = options;
  const maxRounds = options.maxRounds ?? 8;
  const lastClick = new Map<string, number>();
  const histories = new Map<string, HistoryEntry[]>();
  const reveals = new Map<string, number>();
  /** Rounds in a row the widget rejected, per challenge. */
  const rejections = new Map<string, number>();
  /** Slide attempts per puzzle widget. */
  const slides = new Map<string, number>();
  let modelIndex = 0;
  let pointer: Point | undefined;
  let unsettled = 0;
  let empty = 0;
  let previous: { key: string; entry: HistoryEntry; record: RoundRecord } | undefined;
  const finish = (state: SolveResult["state"], detail: string) => finishWith(state, detail, session.announced);
  const scan = async () => (await abortable(driver.scan(adapters), signal)).filter((v) => v.visible);

  // Input first: the extension's debugger infobar shrinks the viewport, so scan after it shows.
  await driver.input.viewport();
  for (;;) {
    signal.throwIfAborted();
    const views = await scan();

    // What the challenge showed after the last model round is that round's verdict.
    if (previous) {
      const errors = views.find((v) => keyOf(v) === previous!.key)?.errors ?? [];
      previous.entry.errorsAfter = errors;
      previous.record.errorsAfter = errors;
      rejections.set(previous.key, errors.length ? (rejections.get(previous.key) ?? 0) + 1 : 0);
      previous = undefined;
    }

    const blocked = views.find((v) => v.status === "blocked");
    if (blocked) return finish("failed", `${blocked.adapter}: blocked`);
    const active = views.filter((v) => v.status === "pending" || v.status === "waiting");
    if (!active.length) {
      if (views.some((v) => v.status === "solved")) return finish("solved", "no challenge left");
      if (!session.announced) return finish("idle", "no challenge found");
      // Seen before, gone now: a frame may be reloading or not answering yet. Look a few times.
      if (++empty >= EMPTY_SCANS_TO_FINISH) return finish("solved", "challenge gone");
      await sleep(500, signal);
      continue;
    }
    empty = 0;
    if (!session.announced) {
      session.announced = true;
      await driver.publish("solving", active[0]!.adapter);
    }

    const view = pickChallenge(active);
    if (!view) {
      await sleep(500, signal);
      continue;
    }
    const spec = adapters.find((a) => a.id === view.adapter)!;
    const viewport = await driver.input.viewport();
    // A challenge larger than the viewport never fits: after a few tries, work with what shows.
    const tries = reveals.get(keyOf(view)) ?? 0;
    if (!contains(viewport, view.region) && (tries < MAX_REVEALS || !intersects(viewport, view.region))) {
      reveals.set(keyOf(view), tries + 1);
      if (tries >= MAX_REVEALS * 3) return finish("failed", `${view.adapter}: cannot scroll it into view`);
      await driver.reveal(view, spec);
      await sleep(400, signal);
      continue;
    }

    if (view.kind === "checkbox") {
      const key = keyOf(view);
      const last = lastClick.get(key);
      if (last !== undefined && Date.now() - last < (spec.retryMs ?? DEFAULT_RETRY_MS)) {
        await sleep(300, signal);
        continue;
      }
      // A person takes a moment to see the widget before clicking it.
      if (last === undefined) await sleep(between(random, 600, 1200), signal);
      const box = view.targets.find((t) => t.id === "checkbox")!.rect;
      pointer = await click(driver, center(box), Math.min(box.width, box.height) / 6, random, pointer);
      lastClick.set(key, Date.now());
      await sleep(800, signal);
      continue;
    }

    session.last = view;
    if (view.kind === "slider") {
      const key = keyOf(view);
      const last = lastClick.get(key);
      if (last !== undefined && Date.now() - last < (spec.retryMs ?? DEFAULT_RETRY_MS)) {
        await sleep(300, signal);
        continue;
      }
      if ((slides.get(key) ?? 0) >= maxRounds) return finish("failed", `${view.adapter}: not solved in ${maxRounds} slides`);
      // A person takes a moment to see the puzzle; the widget animates in meanwhile.
      if (last === undefined) await sleep(between(random, 700, 1300), signal);
      const target = (id: string) => view.targets.find((t) => t.id === id)?.rect;
      const reload = view.targets.find((t) => RELOAD_TARGETS.includes(t.id));
      const handle = target("handle");
      // A refused slider hides its handle behind "error, click to refresh".
      if (!handle) {
        if (reload) {
          lastClick.set(key, Date.now());
          pointer = await click(driver, center(reload.rect), 3, random, pointer);
        } else await sleep(400, signal);
        continue;
      }
      let distance: number;
      const rail = target("rail");
      if (target("piece")) {
        // Puzzle: drag the piece into its gap, found in the images.
        const gap = await driver.puzzle(view, spec);
        if (!gap) {
          await sleep(400, signal);
          continue;
        }
        // An ambiguous gap is a guess, and failed slides count against the site: take another puzzle.
        if (gap.margin < MIN_MARGIN && reload) {
          lastClick.set(key, Date.now());
          pointer = await click(driver, center(reload.rect), 3, random, pointer);
          continue;
        }
        distance = gap.distance;
      } else if (rail) {
        // Slide to end: a few pixels past the rail's end; the widget clamps the handle there.
        distance = rail.x + rail.width - (handle.x + handle.width) + between(random, 4, 8);
      } else {
        return finish("failed", `${view.adapter}: a slider adapter needs a piece and background, or a rail`);
      }
      lastClick.set(key, Date.now());
      const from = { x: center(handle).x + between(random, -1, 1) * Math.min(6, handle.width / 4), y: center(handle).y + between(random, -1, 1) * Math.min(4, handle.height / 4) };
      const steps = dragSteps(from, { x: from.x + distance, y: from.y }, random, pointer);
      await driver.input.mouse(steps);
      pointer = steps.at(-1)!;
      slides.set(key, (slides.get(key) ?? 0) + 1);
      continue;
    }
    const model = models[modelIndex];
    const ask = driver.ask?.bind(driver);
    if (!model && !ask) return finish("failed", `${view.adapter}: no model configured`);
    // Assist mode: the panel goes on the side away from the challenge.
    const side = center(view.region).x < (await driver.input.viewport()).width / 2 ? "right" : "left";
    const solver: Solver = model
      ? { model }
      : {
          ask: async (request) => {
            await driver.publish("solving", `${view.adapter}: answer needed in the captcha panel`);
            return ask!({ ...request, side });
          },
        };
    if (rounds.length >= maxRounds) return finish("failed", `${view.adapter}: not solved in ${maxRounds} rounds`);

    const key = keyOf(view);
    // The model keeps getting this puzzle wrong: ask the widget for another one, with a fresh history.
    const reload = view.targets.find((t) => RELOAD_TARGETS.includes(t.id));
    if (reload && (rejections.get(key) ?? 0) >= REJECTIONS_BEFORE_RELOAD) {
      rejections.set(key, 0);
      histories.set(key, []);
      pointer = await click(driver, center(reload.rect), Math.min(reload.rect.width, reload.rect.height) / 6, random, pointer);
      await sleep(1500, signal);
      continue;
    }
    const history = histories.get(key) ?? [];
    histories.set(key, history);
    const started = Date.now();
    const frames = await capture(driver, view, framesFor(view, spec), signal);
    const record: RoundRecord = {
      time: started,
      url: await driver.url(),
      adapter: view.adapter,
      kind: view.kind,
      round: rounds.length + 1,
      reasoning: "",
      actions: [],
      ms: 0,
      view,
      history: history.slice(-HISTORY_ROUNDS),
      frames,
      labeled: "",
    };
    let thought: Thought;
    try {
      thought = await think(driver.images, solver, view, frames, record.history, {
        animated: isAnimated(view, spec),
        force: unsettled >= MAX_UNSETTLED,
        signal,
      });
    } catch (error) {
      rounds.push(record);
      signal.throwIfAborted();
      record.error = error instanceof Error ? error.message : String(error);
      // Next time, the next model.
      if (models.length) modelIndex = (modelIndex + 1) % models.length;
      record.ms = Date.now() - started;
      options.onRound?.(record);
      await sleep(1000, signal);
      continue;
    }
    const { decision, frame } = thought;
    // Not settled yet (fading tiles, page switch): costs no round, look again shortly.
    if (thought.skipped) {
      unsettled++;
      await sleep(500, signal);
      continue;
    }
    unsettled = 0;
    rounds.push(record);
    Object.assign(record, { reasoning: decision.reasoning, actions: decision.actions, labeled: thought.image, ms: Date.now() - started });

    // The model took seconds: act only if the challenge is still where it was.
    const now = (await scan()).find((v) => keyOf(v) === key);
    if (!now || drift(now.region, view.region) > MAX_DRIFT) {
      record.error = now ? "challenge moved while the model thought; answer dropped" : "challenge gone while the model thought";
      options.onRound?.(record);
      continue;
    }
    options.onRound?.(record);

    pointer = await execute(driver, view, frame, decision.actions, random, signal, pointer);
    const entry: HistoryEntry = { instruction: view.instruction, decision, errorsAfter: [] };
    history.push(entry);
    previous = { key, entry, record };
    // Clicked tiles fade, challenges swap pages: give the widget time to settle.
    await sleep(decision.actions.some((a) => a.kind === "wait") ? 1500 : 2200, signal);
  }
}

async function click(driver: Driver, at: Point, spread: number, random: RandomSource, from?: Point): Promise<Point> {
  const steps = clickSteps(at, random, from, spread);
  await driver.input.mouse(steps);
  return steps.at(-1)!;
}

/** Run a decision's actions; image pixels map back to CSS pixels through the frame's scale. */
export async function execute(
  driver: Driver,
  view: ChallengeView,
  frame: ImageFrame,
  actions: Action[],
  random: RandomSource,
  signal: AbortSignal,
  pointer?: Point,
): Promise<Point | undefined> {
  const toPage = (x: number, y: number): Point => ({ x: view.region.x + x / frame.scale, y: view.region.y + y / frame.scale });
  const targetOf = (id: string | null) => view.targets.find((t) => t.id === id)!;
  for (const action of actions) {
    switch (action.kind) {
      case "click": {
        const { rect } = targetOf(action.target);
        pointer = await click(driver, center(rect), Math.min(rect.width, rect.height) / 6, random, pointer);
        break;
      }
      case "type": {
        const { rect } = targetOf(action.target);
        pointer = await click(driver, center(rect), 2, random, pointer);
        await sleep(between(random, 150, 300), signal);
        await driver.input.type(action.text!);
        break;
      }
      case "clickPoint":
        pointer = await click(driver, toPage(action.x!, action.y!), 1, random, pointer);
        break;
      case "drag": {
        const steps = dragSteps(toPage(action.x!, action.y!), toPage(action.toX!, action.toY!), random, pointer);
        await driver.input.mouse(steps);
        pointer = steps.at(-1)!;
        break;
      }
      case "wait":
        break;
    }
    await sleep(between(random, 250, 600), signal);
  }
  return pointer;
}
