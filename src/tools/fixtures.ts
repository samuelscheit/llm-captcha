import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SlideRecord } from "../core/engine";
import { fixtureFiles, providerOf, roundDir, type Fixture, type FixtureFile } from "../core/fixture";
import type { Expected } from "../core/score";
import type { Action, RoundRecord } from "../core/types";

/** fixtures/<provider>/<name>/ for labeled ones, fixtures/captured/<provider>/<time>-…/ for new captures. */
export const FIXTURES_DIR = path.resolve(import.meta.dirname, "../../fixtures");
export const CAPTURED_DIR = path.join(FIXTURES_DIR, "captured");

export interface StoredFixture extends Fixture {
  /** <provider>/<name> */
  name: string;
  dir: string;
  /** frame-1.png … frame-N.png, PNG base64; the last is current. */
  frames: string[];
}

const frameFiles = (dir: string) =>
  readdirSync(dir)
    .filter((f) => /^frame-\d+\.png$/.test(f))
    .sort((a, b) => parseInt(a.slice(6)) - parseInt(b.slice(6)));

/** Write fixture files (relative paths) into `dir`. */
export function writeFiles(dir: string, files: FixtureFile[]): void {
  for (const file of files) {
    const target = path.join(dir, file.path);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, Buffer.from(file.content, file.encoding === "base64" ? "base64" : "utf8"));
  }
}

/**
 * Write a live round as a fixture: unlabeled under fixtures/captured/<provider>/, or, with a
 * label, straight into fixtures/<provider>/ where eval and bench replay it.
 */
export function saveRound(record: RoundRecord, model: string, label?: { expected: Expected; notes: string }): string {
  const dir = path.join(label ? FIXTURES_DIR : CAPTURED_DIR, roundDir(record));
  writeFiles(dir, fixtureFiles(record, model, label));
  return dir;
}

const subdirs = (dir: string) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

/** Every fixture directory with its parsed fixture.json: "<provider>/<name>", sorted, filtered by substring. */
function fixtureDirs(filter?: string) {
  return subdirs(FIXTURES_DIR)
    .filter((provider) => provider !== "captured")
    .flatMap((provider) => subdirs(path.join(FIXTURES_DIR, provider)).map((name) => `${provider}/${name}`))
    .sort()
    .filter((name) => !filter || name.includes(filter))
    .map((name) => ({ name, dir: path.join(FIXTURES_DIR, name) }))
    .filter(({ dir }) => existsSync(path.join(dir, "fixture.json")))
    .map(({ name, dir }) => ({ name, dir, json: JSON.parse(readFileSync(path.join(dir, "fixture.json"), "utf8")) as Record<string, unknown> }));
}

/** Fixtures of challenges solved without a model, by image analysis, or real pages; the rest are model rounds. */
const WITHOUT_MODEL = ["slider", "shift", "count", "page"];

/** Labeled model fixtures (a view, frames and a non-null `expected`), filtered by "<provider>/<name>" substring. */
export function loadFixtures(filter?: string): StoredFixture[] {
  return fixtureDirs(filter)
    .filter(({ json }) => !WITHOUT_MODEL.includes(json.kind as string))
    .map(({ name, dir, json }) => ({
      ...(json as unknown as Fixture),
      name,
      dir,
      frames: frameFiles(dir).map((f) => readFileSync(path.join(dir, f)).toString("base64")),
    }))
    .filter((f) => f.expected);
}

/**
 * A slide puzzle (Tencent TCaptcha and the like), solved by image analysis rather than a model:
 * background.png, piece.png, where the piece starts and how far it must move (background pixels).
 */
export interface SliderFixture {
  name: string;
  dir: string;
  source: string;
  origin: { x: number; y: number };
  expected: { offset: number };
  notes: string;
  /** PNG files. */
  background: Buffer;
  piece: Buffer;
}

/** A real page (sanitized) served as is and solved by every driver: page.html plus what must happen. */
export interface PageFixture {
  name: string;
  dir: string;
  source: string;
  notes: string;
  /** Appended to the fixture's URL when adapters match on the original one (a vendor's frame path). */
  path?: string;
  /** Adapters a pass verifies on a real (saved) widget, for the coverage table. */
  verifies?: string[];
  /**
   * Either solved by every driver (`state`, optionally landing on `navigatesTo`), or, for a saved
   * snapshot that no longer reacts (scripts stripped), what the scan finds (`views`).
   */
  expected: { state?: "solved"; navigatesTo?: string; views?: { adapter: string; status: string; targets: string[] }[] };
  /** Pages that answer by navigating: a request whose query has all these values is redirected (the right answer). */
  redirects?: { query: Record<string, string>; to: string }[];
  /** What the mock model answers to a prompt with this instruction: the right answer, known from the capture. */
  model?: { instruction: string; actions: Action[] };
  html: string;
}

export function loadPageFixtures(filter?: string): PageFixture[] {
  return fixtureDirs(filter)
    .filter(({ json }) => json.kind === "page")
    .map(({ name, dir, json }) => ({
      ...(json as unknown as Omit<PageFixture, "name" | "dir" | "html">),
      name,
      dir,
      html: readFileSync(path.join(dir, "page.html"), "utf8"),
    }));
}

/**
 * Write a slide the vendor accepted as a slider fixture, fixtures/<provider>/<adapter>-<time>/:
 * the images as measured, where the piece started, and the offset that passed.
 */
export function saveSlide(slide: SlideRecord, notes: string): string {
  const stamp = new Date(slide.time).toISOString().replace(/[:.]/g, "-");
  const dir = path.join(FIXTURES_DIR, providerOf(slide.adapter), `${slide.adapter}-${stamp}`);
  writeFiles(dir, [
    { path: "background.png", content: slide.background, encoding: "base64" },
    { path: "piece.png", content: slide.piece, encoding: "base64" },
    {
      path: "fixture.json",
      content: `${JSON.stringify({ kind: "slider", source: slide.url, origin: slide.origin, expected: { offset: Math.round(slide.offset) }, notes }, null, 2)}\n`,
      encoding: "utf-8",
    },
  ]);
  return dir;
}

export function loadSliderFixtures(filter?: string): SliderFixture[] {
  return fixtureDirs(filter)
    .filter(({ json }) => json.kind === "slider")
    .map(({ name, dir, json }) => ({
      ...(json as unknown as Omit<SliderFixture, "name" | "dir" | "background" | "piece">),
      name,
      dir,
      background: readFileSync(path.join(dir, "background.png")),
      piece: readFileSync(path.join(dir, "piece.png")),
    }));
}

/**
 * A shifted grid (DogWAF): reference.png, challenge.png and the roll the server issued (from its
 * decrypted token) or accepted, in squares of a `grid` × `grid` grid.
 */
export interface ShiftFixture {
  name: string;
  dir: string;
  source: string;
  grid: number;
  expected: { dx: number; dy: number };
  notes: string;
  /** PNG files. */
  reference: Buffer;
  challenge: Buffer;
}

export function loadShiftFixtures(filter?: string): ShiftFixture[] {
  return fixtureDirs(filter)
    .filter(({ json }) => json.kind === "shift")
    .map(({ name, dir, json }) => ({
      ...(json as unknown as Omit<ShiftFixture, "name" | "dir" | "reference" | "challenge">),
      name,
      dir,
      reference: readFileSync(path.join(dir, "reference.png")),
      challenge: readFileSync(path.join(dir, "challenge.png")),
    }));
}

/**
 * Stamp counting (DogWAF's compat challenge): image-1.png … image-N.png and their true counts.
 * `counted: false` marks images beyond image analysis, where it must decline and leave the count
 * to the model.
 */
export interface CountFixture {
  name: string;
  dir: string;
  source: string;
  stamps: { size: number; wobble: number };
  expected: { counts: number[] };
  counted: boolean;
  notes: string;
  /** PNG files, in order. */
  images: Buffer[];
}

export function loadCountFixtures(filter?: string): CountFixture[] {
  return fixtureDirs(filter)
    .filter(({ json }) => json.kind === "count")
    .map(({ name, dir, json }) => ({
      ...(json as unknown as Omit<CountFixture, "name" | "dir" | "images">),
      name,
      dir,
      images: readdirSync(dir)
        .filter((f) => /^image-\d+\.png$/.test(f))
        .sort((a, b) => parseInt(a.slice(6)) - parseInt(b.slice(6)))
        .map((f) => readFileSync(path.join(dir, f))),
    }));
}
