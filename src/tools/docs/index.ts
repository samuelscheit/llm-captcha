/**
 * `bun run docs`: the README's figures, computed from real fixtures by the solver's own code, into
 * docs/img/. Reproducible and offline: live vendor screenshots are captured once with `--capture`
 * into docs/img/providers/raw/ and committed.
 *
 *   bun run docs                      every figure
 *   bun run docs -- --only slider,hero  some of them
 *   bun run docs -- --capture [names] capture live provider screenshots first (headful Chrome)
 */
import { parseArgs } from "node:util";
import { launch } from "../browser";
import { gesturesFigure } from "./gestures";
import { heroFigure } from "./hero";
import { captureProviders, providerThumbnails } from "./providers";
import { Renderer } from "./render";
import { shiftFigure } from "./shift";
import { sliderFigure } from "./slider";
import { socialFigure } from "./social";
import { stampsFigure } from "./stamps";
import { visionFigure } from "./vision";

/** Each figure family; returns the files it wrote. */
const FIGURES: Record<string, (renderer: Renderer) => Promise<string | string[]>> = {
  hero: heroFigure,
  gestures: gesturesFigure,
  vision: visionFigure,
  slider: sliderFigure,
  shift: shiftFigure,
  stamps: stampsFigure,
  providers: providerThumbnails,
  // Last: its collage uses the provider thumbnails.
  social: socialFigure,
};

const { values } = parseArgs({ options: { only: { type: "string" }, capture: { type: "string" } }, allowPositionals: false, args: normalize(process.argv.slice(2)) });

/** `--capture` alone captures every provider without fixtures; parseArgs wants a value. */
function normalize(args: string[]): string[] {
  return args.flatMap((a, i) => (a === "--capture" && (args[i + 1] === undefined || args[i + 1]!.startsWith("--")) ? ["--capture", ""] : [a]));
}

const only = values.only?.split(",").filter(Boolean);
for (const name of only ?? []) if (!FIGURES[name]) throw new Error(`Unknown figure "${name}": ${Object.keys(FIGURES).join(", ")}`);

const browser = await launch();
try {
  if (values.capture !== undefined) {
    const report = await captureProviders(browser.context, values.capture.split(",").filter(Boolean));
    for (const [provider, outcome] of Object.entries(report)) console.log(`capture ${provider}: ${outcome}`);
  }
  const tab = browser.context.pages()[0] ?? (await browser.context.newPage());
  const renderer = new Renderer(tab);
  for (const [name, render] of Object.entries(FIGURES)) {
    if (only && !only.includes(name)) continue;
    const files = [await render(renderer)].flat();
    for (const file of files) console.log(`${name}: ${file}`);
  }
} finally {
  await browser.close();
}
