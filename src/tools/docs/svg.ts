/**
 * Shared parts of the animated SVG figures: a card that reads in light and dark themes, keyframes
 * on one loop, and the end state as the still image for prefers-reduced-motion.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { COLOR, optimizePng } from "./render";

/** Light palette first; the dark one applies under prefers-color-scheme: dark. */
export const SVG_THEME = `
.card{fill:${COLOR.surface};stroke:${COLOR.line}}.ink{fill:${COLOR.text}}.muted{fill:${COLOR.muted}}.line{stroke:${COLOR.line}}
.accent{fill:${COLOR.accent}}.good{fill:${COLOR.good}}.chipbg{fill:#e8eefc}.chiptext{fill:${COLOR.accent}}
text{font-family:system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif}
.mono{font-family:ui-monospace,"SF Mono",Menlo,monospace}
@media (prefers-color-scheme:dark){
.card{fill:#161b22;stroke:#30363d}.ink{fill:#e6edf3}.muted{fill:#8b949e}.line{stroke:#30363d}
.accent{fill:#6e9bff}.good{fill:#4ac384}.chipbg{fill:#1c2a4d}.chiptext{fill:#a9c1ff}}
.a{animation-duration:var(--loop);animation-iteration-count:infinite;animation-timing-function:linear;animation-fill-mode:both}
@media (prefers-reduced-motion:reduce){.a{animation:none!important}}`;

/** Collects one keyframes rule per animated element, all on the same loop. */
export class Timeline {
  private rules: string[] = [];
  private count = 0;

  constructor(readonly loopMs: number) {}

  private pct = (ms: number) => `${Math.min(100, Math.max(0, (ms / this.loopMs) * 100)).toFixed(3)}%`;

  /** Keyframes from [ms, css] pairs; returns the attribute string to put on the element. */
  keyframes(frames: [number, string][], extraStyle = ""): string {
    const name = `k${this.count++}`;
    this.rules.push(`@keyframes ${name}{${frames.map(([ms, css]) => `${this.pct(ms)}{${css}}`).join("")}}`);
    return `class="a" style="animation-name:${name};${extraStyle}"`;
  }

  /** Hidden until `at`, then fades in over `fadeMs` and stays until the loop fades everything out. */
  appear(at: number, fadeMs = 250, extraStyle = ""): string {
    const end = this.loopMs - 350;
    return this.keyframes(
      [
        [0, "opacity:0"],
        [at, "opacity:0"],
        [at + fadeMs, "opacity:1"],
        [end, "opacity:1"],
        [this.loopMs, "opacity:0"],
      ],
      extraStyle,
    );
  }

  css(): string {
    return `svg{--loop:${this.loopMs}ms}\n${this.rules.join("\n")}`;
  }
}

/** A PNG as a data URL, quantized first: the SVG embeds it, so its bytes count. */
export function compactPngUrl(file: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "docs-svg-"));
  try {
    const copy = path.join(dir, "image.png");
    writeFileSync(copy, readFileSync(file));
    optimizePng(copy);
    return `data:image/png;base64,${readFileSync(copy).toString("base64")}`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const svgDocument = (width: number, height: number, css: string, body: string, title: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}">
<title>${title}</title>
<style>${css}</style>
${body}
</svg>
`;
