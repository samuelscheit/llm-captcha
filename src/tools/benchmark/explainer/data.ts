/**
 * Everything the "How it works" page shows, computed at build time from the real fixtures and the
 * real solver code: model rounds as the model saw them, slide puzzles, shifted grids and stamp
 * counts run through the same image analysis the engine uses, and pointer tracks sampled from the
 * gesture planner. Images the page shows are registered with `assets`, which copies them.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { imageFrame } from "../../../core/engine";
import { holdTrack } from "../../../core/kinds/hold";
import { between, clickSteps, dragSteps, seeded, type MouseStep, type Point } from "../../../core/mouse";
import { findPuzzleGap, MIN_MARGIN, type Pixels } from "../../../core/puzzle";
import { score, type Expected } from "../../../core/score";
import { findGridShift, MIN_SHIFT_MARGIN } from "../../../core/shift";
import { grey, learnStamp, peelStamps } from "../../../core/stamps";
import type { Action, ChallengeView, Decision } from "../../../core/types";
import { loadCountFixtures, loadFixtures, loadShiftFixtures, loadSliderFixtures, type StoredFixture } from "../../fixtures";
import type { CoverageRow } from "../coverage";

/** Copies a fixture file into the site and returns its URL relative to the page. */
export type Assets = (dir: string, file: string) => string;

/** Display names of the providers (first segment of the adapter ids), in the order the page lists them. */
export const PROVIDER_NAMES: Record<string, string> = {
  recaptcha: "reCAPTCHA",
  hcaptcha: "hCaptcha",
  turnstile: "Cloudflare Turnstile",
  cloudflare: "Cloudflare",
  geetest: "GeeTest",
  arkose: "Arkose",
  tencent: "Tencent",
  aliyun: "Aliyun",
  yidun: "NetEase Yidun",
  shumei: "Shumei",
  dingxiang: "Dingxiang",
  datadome: "DataDome",
  awswaf: "AWS WAF",
  yandex: "Yandex",
  mtcaptcha: "MTCaptcha",
  human: "HUMAN",
  friendlycaptcha: "Friendly Captcha",
  altcha: "ALTCHA",
  mcaptcha: "mCaptcha",
  anubis: "Anubis",
  dogwaf: "DogWAF",
  gname: "GNAME",
  generic: "Generic",
};
const providerOrder = (id: string) => (id in PROVIDER_NAMES ? Object.keys(PROVIDER_NAMES).indexOf(id) : Infinity);
const providerName = (id: string) => PROVIDER_NAMES[id] ?? id;
const host = (url: string) => (/^https?:/.test(url) ? new URL(url).host : url);
const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;
const pngOf = (buffer: Buffer) => PNG.sync.read(buffer) as Pixels;
const groupBy = <T>(items: T[], key: (item: T) => string) => {
  const groups = new Map<string, T[]>();
  for (const item of items) (groups.get(key(item)) ?? groups.set(key(item), []).get(key(item))!).push(item);
  return groups;
};

// ---------------------------------------------------------------- model rounds

/** Fixtures shown per provider: enough to see each adapter, few enough to keep the site small. */
const ROUNDS_PER_PROVIDER = 5;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RoundData {
  id: string;
  provider: string;
  adapter: string;
  kind: string;
  instruction: string;
  source: string;
  notes: string;
  /** Image size the model got, and image px per CSS px. */
  width: number;
  height: number;
  scale: number;
  frames: string[];
  labeled: string | null;
  /** In image px; `box` null for targets outside the screenshot. */
  targets: { id: string; box: Box | null; label?: string; selected?: boolean }[];
  /** In image px. */
  expected: { clicks?: string[]; text?: string; points?: { x: number; y: number; r: number }[] };
  answer: { model: string; reasoning: string; actions: Action[] } | null;
  verdict: { pass: boolean; problems: string[] } | null;
  errorsAfter: string[];
  /** The latest `bun run eval` of this fixture, when one was kept. */
  lastEval: { model: string; pass: boolean; problems: string[]; actions: Action[] } | null;
}

interface Observed {
  model: string;
  decision: Decision;
  errorsAfter: string[];
}

function roundOf(f: StoredFixture, assets: Assets): RoundData {
  const view = f.view as ChallengeView;
  const frame = imageFrame(view.region);
  const toImage = (r: { x: number; y: number; width: number; height: number }): Box | null => {
    const box = { x: (r.x - view.region.x) * frame.scale, y: (r.y - view.region.y) * frame.scale, w: r.width * frame.scale, h: r.height * frame.scale };
    return box.x + box.w <= 0 || box.y + box.h <= 0 || box.x >= frame.width || box.y >= frame.height ? null : box;
  };
  const expected = f.expected as Expected;
  const observed = (f as unknown as { observed?: Observed }).observed;
  const evalFile = path.join(f.dir, "last-eval.json");
  const lastEval = existsSync(evalFile) ? (JSON.parse(readFileSync(evalFile, "utf8")) as { model: string; pass: boolean; problems: string[]; decision: Decision }) : null;
  const frameFiles = f.frames.map((_, i) => `frame-${i + 1}.png`);
  return {
    id: f.name,
    provider: f.name.split("/")[0]!,
    adapter: view.adapter,
    kind: view.kind,
    instruction: view.instruction,
    source: host(f.source),
    notes: f.notes,
    width: frame.width,
    height: frame.height,
    scale: frame.scale,
    frames: frameFiles.map((file) => assets(f.dir, file)),
    labeled: existsSync(path.join(f.dir, "labeled.png")) ? assets(f.dir, "labeled.png") : null,
    targets: view.targets.map((t) => ({ id: t.id, box: toImage(t.rect), ...(t.label ? { label: t.label } : {}), ...(t.selected !== undefined ? { selected: t.selected } : {}) })),
    expected: {
      ...(expected.clicks ? { clicks: expected.clicks } : {}),
      ...(expected.text !== undefined ? { text: expected.text } : {}),
      ...(expected.points ? { points: expected.points.map((p) => ({ x: p.x * frame.scale, y: p.y * frame.scale, r: p.r * frame.scale })) } : {}),
    },
    answer: observed?.decision ? { model: observed.model, reasoning: observed.decision.reasoning, actions: observed.decision.actions } : null,
    verdict: observed?.decision ? score(observed.decision, expected, frame) : null,
    errorsAfter: observed?.errorsAfter ?? [],
    lastEval: lastEval && { model: lastEval.model, pass: lastEval.pass, problems: lastEval.problems, actions: lastEval.decision.actions },
  };
}

/** Per provider, fixtures spread over its adapters (hand-labeled ones first), with a miss when there is one. */
function pickRounds(fixtures: StoredFixture[], assets: Assets): RoundData[] {
  const byProvider = groupBy(fixtures, (f) => f.name.split("/")[0]!);
  return [...byProvider].sort(([a], [b]) => providerOrder(a) - providerOrder(b)).flatMap(([, list]) => {
    const handLabeled = (f: StoredFixture) => (/^\d/.test(f.name.split("/")[1]!) ? 1 : 0);
    const byAdapter = [...groupBy([...list].sort((a, b) => handLabeled(a) - handLabeled(b)), (f) => (f.view as ChallengeView).adapter).values()];
    const picked: StoredFixture[] = [];
    for (let i = 0; picked.length < Math.min(ROUNDS_PER_PROVIDER, list.length); i++) for (const group of byAdapter) if (group[i] && picked.length < ROUNDS_PER_PROVIDER) picked.push(group[i]!);
    // The page shows misses too: swap one in when the picks all passed.
    const missed = (f: StoredFixture) => {
      const decision = (f as unknown as { observed?: Observed }).observed?.decision;
      return !!decision && !score(decision, f.expected as Expected, imageFrame((f.view as ChallengeView).region)).pass;
    };
    const miss = picked.some(missed) ? undefined : list.find(missed);
    if (miss) picked[picked.length - 1] = miss;
    return picked.map((f) => roundOf(f, assets));
  });
}

// ---------------------------------------------------------------- slide puzzles

export interface SliderData {
  id: string;
  provider: string;
  source: string;
  notes: string;
  background: string;
  piece: string;
  bg: { w: number; h: number };
  pc: { w: number; h: number };
  origin: { x: number; y: number };
  expected: number;
  found: number;
  margin: number;
  /** [offset, score] at every offset tried. */
  scores: [number, number][];
}

function sliders(assets: Assets): SliderData[] {
  return loadSliderFixtures().map((f) => {
    const [background, piece] = [pngOf(f.background), pngOf(f.piece)];
    const gap = findPuzzleGap(background, piece, f.origin);
    return {
      id: f.name,
      provider: f.name.split("/")[0]!,
      source: host(f.source),
      notes: f.notes,
      background: assets(f.dir, "background.png"),
      piece: assets(f.dir, "piece.png"),
      bg: { w: background.width, h: background.height },
      pc: { w: piece.width, h: piece.height },
      origin: f.origin,
      expected: f.expected.offset,
      found: gap.offset,
      margin: round(gap.margin, 3),
      scores: gap.scores.map(([x, s]) => [x, round(s, 4)]),
    };
  });
}

// ---------------------------------------------------------------- shifted grids

export interface ShiftData {
  id: string;
  source: string;
  notes: string;
  grid: number;
  size: number;
  reference: string;
  challenge: string;
  expected: { dx: number; dy: number };
  found: { dx: number; dy: number };
  margin: number;
  /** Row-major: scores[dy * grid + dx]. */
  scores: number[];
}

function shifts(assets: Assets): ShiftData[] {
  return loadShiftFixtures().map((f) => {
    const reference = pngOf(f.reference);
    const shift = findGridShift(reference, pngOf(f.challenge), f.grid);
    return {
      id: f.name,
      source: host(f.source),
      notes: f.notes,
      grid: f.grid,
      size: reference.width,
      reference: assets(f.dir, "reference.png"),
      challenge: assets(f.dir, "challenge.png"),
      expected: f.expected,
      found: { dx: shift.dx, dy: shift.dy },
      margin: round(shift.margin, 3),
      scores: shift.scores.map((s) => round(s, 3)),
    };
  });
}

// ---------------------------------------------------------------- stamp counting

export interface CountData {
  id: string;
  source: string;
  notes: string;
  counted: boolean;
  size: number;
  wobble: number;
  images: string[];
  imageSize: { w: number; h: number };
  /** The learned picture as grey columns, or null when none recurs. */
  stamp: number[][] | null;
  /** Per image, per peeling pass, the copies found: left column and each column's top row. */
  passes: { x: number; tops: number[] }[][][];
  expected: number[];
}

function counts(assets: Assets): CountData[] {
  return loadCountFixtures().map((f) => {
    const greys = f.images.map((b) => grey(pngOf(b)));
    const stamp = learnStamp(greys, f.stamps);
    const passes = stamp ? greys.map((g) => peelStamps(g, stamp, f.stamps)) : greys.map(() => []);
    // countStamps' rule: a picture found fewer than twice in all images was noise.
    const found = passes.flat(2).length;
    return {
      id: f.name,
      source: host(f.source),
      notes: f.notes,
      counted: f.counted,
      size: f.stamps.size,
      wobble: f.stamps.wobble,
      images: f.images.map((_, i) => assets(f.dir, `image-${i + 1}.png`)),
      imageSize: { w: greys[0]!.width, h: greys[0]!.height },
      stamp: stamp && found >= 2 ? stamp.map((column) => [...column]) : null,
      passes: stamp && found >= 2 ? passes : greys.map(() => []),
      expected: f.expected.counts,
    };
  });
}

// ---------------------------------------------------------------- pointer tracks

export interface Track {
  /** x, y, button down (1/0), time ms. */
  points: [number, number, 0 | 1, number][];
  duration: number;
}

const trackOf = (steps: MouseStep[]): Track => {
  let t = 0;
  const points = steps.map((s): [number, number, 0 | 1, number] => {
    const point: [number, number, 0 | 1, number] = [round(s.x, 1), round(s.y, 1), s.type === "mouseReleased" ? 0 : s.buttons, Math.round(t)];
    t += s.delayMs;
    return point;
  });
  return { points, duration: Math.round(t) };
};

/** Tracks for a 320 × 160 canvas, sampled from the gesture planner with fixed seeds. */
function tracks() {
  const start: Point = { x: 24, y: 136 };
  const checkbox = clickSteps({ x: 70, y: 80 }, seeded(3), start, 4);
  // Press & Hold exactly as kinds/hold.ts plans it, held for 4 s.
  const hold = holdTrack({ x: 100, y: 80, width: 0, height: 0 }, 4000, seeded(5), start);
  const pow = clickSteps({ x: 52, y: 80 }, seeded(9), start, 4);
  // Slide to end: from the handle to a few px past the rail's end (engine.ts), on dragSteps.
  const slide = seeded(11);
  const slideEnd = dragSteps({ x: 40, y: 80 }, { x: 280 + between(slide, 4, 8), y: 80 }, slide, start);
  return { checkbox: trackOf(checkbox), hold: trackOf(hold), pow: trackOf(pow), slide: trackOf(slideEnd) };
}

// ---------------------------------------------------------------- the page's data

export interface ExplainerData {
  rounds: RoundData[];
  sliders: SliderData[];
  shifts: ShiftData[];
  counts: CountData[];
  tracks: ReturnType<typeof tracks>;
  coverage: { provider: string; name: string; adapters: string[]; methods: string[]; verified: number }[];
  constants: { minMargin: number; minShiftMargin: number };
  providers: Record<string, string>;
}

/** Coverage per provider: its adapters, how they are solved, how many passed against the real widget. */
function coverageByProvider(rows: CoverageRow[]): ExplainerData["coverage"] {
  return [...groupBy(rows, (r) => r.provider)].map(([provider, list]) => ({
    provider,
    name: providerName(provider),
    adapters: list.map((r) => r.adapter),
    methods: [...new Set(list.map((r) => r.method))],
    verified: list.filter((r) => r.verification.passedAt && !r.verification.failedAt).length,
  }));
}

export function explainerData(assets: Assets, covered: CoverageRow[]): ExplainerData {
  return {
    rounds: pickRounds(loadFixtures(), assets),
    sliders: sliders(assets),
    shifts: shifts(assets),
    counts: counts(assets),
    tracks: tracks(),
    coverage: coverageByProvider(covered),
    constants: { minMargin: MIN_MARGIN, minShiftMargin: MIN_SHIFT_MARGIN },
    providers: PROVIDER_NAMES,
  };
}
