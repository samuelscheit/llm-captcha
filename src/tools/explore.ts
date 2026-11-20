/**
 * Look at a challenge the way an adapter has to: every frame's visible element tree (closed shadow
 * roots included), its HTML, and a screenshot, saved under out/explore/<name>-<time>/.
 *
 *   bun run explore --vendor recaptcha|hcaptcha|turnstile|tencent
 *   bun run explore <url> [--fill selector=value]... [--click selector]... [--wait ms]
 *
 * --vendor opens one of src/tools/vendor-pages.ts and clicks through to its challenge. On other
 * pages, --fill types into fields and --click clicks (in any frame), in that order: what it takes
 * for a form to show its challenge.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { CdpDriver } from "../cdp/driver";
import { playwrightHost } from "../cdp/playwright";
import { launch } from "./browser";
import { clickInAnyFrame, openVendorPage, vendorPage } from "./vendor-pages";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    fill: { type: "string", multiple: true, default: [] },
    click: { type: "string", multiple: true, default: [] },
    wait: { type: "string", default: "4000" },
    vendor: { type: "string" },
  },
});
const url = positionals[0];
if (!values.vendor && !url) throw new Error("Usage: bun run explore --vendor <name> | <url> [--click selector]... [--wait ms]");

const browser = await launch();
const page = browser.context.pages()[0] ?? (await browser.context.newPage());
try {
  if (values.vendor) await openVendorPage(browser.context, page, vendorPage(values.vendor), { reveal: true });
  else await page.goto(url!);
  for (const assignment of values.fill!) {
    // Selectors often contain "=" ([name=email]); values rarely do.
    const split = assignment.lastIndexOf("=");
    if (split < 1) throw new Error(`--fill takes selector=value, got "${assignment}"`);
    await page.locator(assignment.slice(0, split)).first().fill(assignment.slice(split + 1));
  }
  for (const selector of values.click!) {
    await clickInAnyFrame(page, selector);
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(Number(values.wait));

  const host = await playwrightHost(page);
  const frames = await new CdpDriver(host).inspect();
  await host.dispose();
  const name = values.vendor ?? new URL(url!).hostname;
  const out = path.resolve(import.meta.dirname, "../../out/explore", `${name}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  mkdirSync(out, { recursive: true });
  await page.screenshot({ path: path.join(out, "page.png") });
  const report = frames.map((f, i) => `===== frame ${i + 1}: ${f.url}\n${f.skeleton}`).join("\n\n");
  writeFileSync(path.join(out, "frames.txt"), `${report}\n`);
  frames.forEach((f, i) => writeFileSync(path.join(out, `frame-${i + 1}.html`), f.html));
  console.log(report);
  console.log(`\nsaved to ${out}`);
} finally {
  await browser.close();
}
