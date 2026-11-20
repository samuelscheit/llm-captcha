import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fixtureFiles, roundDir, type Fixture, type FixtureFile } from "../core/fixture";
import type { RoundRecord } from "../core/types";

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

/** Write a live round as an unlabeled fixture under fixtures/captured/<provider>/. */
export function saveRound(record: RoundRecord, model: string): string {
  const dir = path.join(CAPTURED_DIR, roundDir(record));
  writeFiles(dir, fixtureFiles(record, model));
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

/** Labeled model fixtures (a view, frames and a non-null `expected`), filtered by "<provider>/<name>" substring. */
export function loadFixtures(filter?: string): StoredFixture[] {
  return fixtureDirs(filter)
    .filter(({ json }) => json.kind !== "slider")
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
