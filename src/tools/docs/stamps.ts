/**
 * method-stamps.png: DogWAF's compat challenge counted by src/core/stamps.ts. One noisy image, the
 * picture learnStamp recovers from all five, and peelStamps' passes over that image (each pass
 * uncovers the copies the previous one painted over), with every image's count against its label.
 */
import { grey, learnStamp, peelStamps, type StampPlacement, type StampShape } from "../../core/stamps";
import { COLOR, dataUrl, encodePng, escapeHtml, fileUrl, fixturePath, readJson, readPng, SERIES, type Renderer } from "./render";

const FIXTURE = "dogwaf/compat-fork-2";
/** The image shown large: the one with the most copies. */
const SHOWN = 0;
const SCALE = 3.2;

interface CountFixture {
  stamps: StampShape;
  expected: { counts: number[] };
}

/** The learned picture (columns of greys) as an RGBA image. */
function stampImage(columns: Uint8Array[]) {
  const size = columns.length;
  const data = new Uint8ClampedArray(size * size * 4);
  columns.forEach((column, x) => column.forEach((v, y) => data.set([v, v, v, 255], (y * size + x) * 4)));
  return { width: size, height: size, data };
}

/** A copy's outline: each column's top and bottom follow its own wobble. */
function outline({ x, tops }: StampPlacement, size: number): string {
  const top = tops.map((t, c) => `${x + c},${t} ${x + c + 1},${t}`);
  const bottom = tops.map((t, c) => `${x + c + 1},${t + size} ${x + c},${t + size}`).reverse();
  return [...top, ...bottom].join(" ");
}

export async function stampsFigure(renderer: Renderer): Promise<string> {
  const dir = fixturePath(FIXTURE);
  const fixture = readJson<CountFixture>(`${dir}/fixture.json`);
  const { expected, stamps: shape } = fixture;
  const files = expected.counts.map((_, i) => `${dir}/image-${i + 1}.png`);
  const greys = files.map((f) => grey(readPng(f)));
  const stamp = learnStamp(greys, shape);
  if (!stamp) throw new Error(`${FIXTURE}: no picture learned`);
  const passes = greys.map((g) => peelStamps(g, stamp, shape));
  const counts = passes.map((p) => p.flat().length);
  const shown = greys[SHOWN]!;
  const [w, h] = [shown.width * SCALE, shown.height * SCALE];
  const overlay = `<svg class="overlay" width="${w}" height="${h}" viewBox="0 0 ${shown.width} ${shown.height}">${passes[SHOWN]!
    .map((pass, p) => pass.map((copy) => `<polygon points="${outline(copy, shape.size)}" fill="none" stroke="${SERIES[p % SERIES.length]}" stroke-width="${2.4 / SCALE}" stroke-linejoin="round"/>`).join(""))
    .join("")}</svg>`;
  const legend = passes[SHOWN]!.map((pass, p) => `<span class="key"><i style="background:${SERIES[p % SERIES.length]}"></i>pass ${p + 1}: ${pass.length}</span>`).join("");
  const verdict = (got: number, want: number) => (got === want ? `<span class="good">${got} ✓</span>` : `<span class="bad">${got} ≠ ${want}</span>`);
  const strip = files
    .map((f, i) => `<figure><img class="shot px" src="${fileUrl(f)}" width="100" height="100"><figcaption>${verdict(counts[i]!, expected.counts[i]!)}</figcaption></figure>`)
    .join("");
  const body = `<h1>Counting pasted copies: learned and peeled, not guessed</h1>
<p class="lede">DogWAF's compat check asks how many copies of a small picture each image holds, including copies later ones painted over. Nobody says what the picture is: the solver learns it from the columns that recur across all five images, then peels copies off, topmost first, until none fit.</p>
<div class="row">
<div><p class="step"><b>1</b>One challenge image</p><img class="shot px" src="${fileUrl(files[SHOWN]!)}" width="${w}" height="${h}"><p class="cap">${shown.width}×${shown.height} px of noise with pasted copies.</p></div>
<div class="learned"><p class="step"><b>2</b>Learned picture</p><img class="shot px" src="${dataUrl(encodePng(stampImage(stamp)))}" width="${shape.size * 8}" height="${shape.size * 8}"><p class="cap">${shape.size}×${shape.size}, learned from all five images: its columns recur, noise does not.</p></div>
<div><p class="step"><b>3</b>Peeled, pass by pass</p><div class="stack"><img class="shot px" src="${fileUrl(files[SHOWN]!)}" width="${w}" height="${h}">${overlay}</div><p class="cap">${legend}</p></div>
</div>
<p class="step" style="margin-top:22px"><b>4</b>Count per image vs. the challenge token</p>
<div class="strip">${strip}<p class="total">${counts.join(" · ")}<br><span>found, expected ${expected.counts.join(" · ")}</span></p></div>
<p class="foot">Fixture <span class="mono">${escapeHtml(FIXTURE)}</span> · src/core/stamps.ts</p>`;
  return renderer.figure("method-stamps.png", body, {
    width: 960,
    css: `.row{display:flex;gap:28px;align-items:flex-start;justify-content:space-between}.learned{width:200px}.stack{position:relative}.overlay{position:absolute;left:1px;top:1px}
.key{display:inline-flex;align-items:center;gap:5px;margin-right:12px}.key i{width:10px;height:10px;border-radius:2px}
.strip{display:flex;gap:16px;align-items:center}.strip figure{margin:0;text-align:center;font-weight:700;font-size:13px}.strip figcaption{margin-top:4px}
.total{margin:0 0 0 12px;font-size:20px;font-weight:700;letter-spacing:.02em}.total span{font-size:12.5px;font-weight:400;color:${COLOR.muted};letter-spacing:0}`,
  });
}
