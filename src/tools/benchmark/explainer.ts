/**
 * The site's "How it works" page (out/site/how-it-works.html): computes its data from the fixtures
 * and the solver code, copies the fixture images it shows into out/site/assets/, writes the page.
 */
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { FIXTURES_DIR } from "../fixtures";
import type { CoverageRow } from "./coverage";
import { explainerData } from "./explainer/data";
import { renderExplainer } from "./explainer/page";

export function writeExplainer(siteDir: string, covered: CoverageRow[]): void {
  const assets = (dir: string, file: string) => {
    const url = `assets/${path.relative(FIXTURES_DIR, dir)}/${file}`;
    mkdirSync(path.dirname(path.join(siteDir, url)), { recursive: true });
    copyFileSync(path.join(dir, file), path.join(siteDir, url));
    return url;
  };
  writeFileSync(path.join(siteDir, "how-it-works.html"), renderExplainer(explainerData(assets, covered)));
}
