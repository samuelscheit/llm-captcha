/**
 * Solve challenges on live pages with the real model and save every round under
 * fixtures/captured/<provider>/ for labeling.
 *
 *   bun run capture --vendor recaptcha --vendor hcaptcha [--sessions N]
 *   bun run capture <url> [<url> …] [--sessions N]
 *
 * --vendor opens one of src/tools/vendor-pages.ts. Label a round by setting `expected` (and notes)
 * in its fixture.json, then move it to fixtures/<provider>/<descriptive-name>/ so `bun run eval`
 * replays it.
 *
 * --accept labels what the vendor itself accepted: in a session the vendor passed, every round it
 * did not object to (no error afterwards) goes straight into fixtures/<provider>/ with its answer as
 * the expected one. Rejected and unsure rounds still go to fixtures/captured/ for a person.
 */
import { parseArgs } from "node:util";
import { BUILTIN_ADAPTERS } from "../core/adapters";
import { solve } from "../core/engine";
import { createModel } from "../core/solver";
import { CdpDriver } from "../cdp/driver";
import { playwrightHost } from "../cdp/playwright";
import { launch } from "./browser";
import { liveModel } from "./model";
import { acceptedExpected } from "../core/fixture";
import type { SlideRecord } from "../core/engine";
import { saveRound, saveSlide } from "./fixtures";
import { openVendorPage, vendorPage, vendorPassed, type VendorPage } from "./vendor-pages";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    sessions: { type: "string", default: "1" },
    vendor: { type: "string", multiple: true, default: [] },
    accept: { type: "boolean", default: false },
  },
});
const pages: VendorPage[] = [...values.vendor!.map(vendorPage), ...positionals.map((url) => ({ url }))];
if (!pages.length) throw new Error("Usage: bun run capture --vendor <name>... | <url>... [--sessions N]");
const config = liveModel();
const model = createModel(config);
const browser = await launch();
const page = browser.context.pages()[0] ?? (await browser.context.newPage());
try {
  for (const target of pages) {
    const url = target.url;
    for (let session = 1; session <= Number(values.sessions); session++) {
      // The solver clicks checkboxes itself; only a widget behind a button needs opening.
      await openVendorPage(browser.context, page, target);
      const host = await playwrightHost(page);
      const driver = new CdpDriver(host);
      const slides: SlideRecord[] = [];
      const run = () => solve(driver, { adapters: BUILTIN_ADAPTERS, models: [model], onSlide: (s) => slides.push(s) });
      let result = await run();
      for (let i = 0; result.state === "idle" && i < 10; i++) {
        await page.waitForTimeout(1000);
        result = await run();
      }
      const passed = result.state === "solved" || (await vendorPassed(page));
      console.log(`${url} #${session}: ${result.state} (${result.detail}), vendor ${passed ? "passed" : "did not pass"}, ${result.rounds.length} model rounds, ${slides.length} slides`);
      // The last slide of a session the vendor passed had the right offset.
      const accepted = slides.at(-1);
      if (values.accept && passed && accepted) {
        console.log(`  slide → ${saveSlide(accepted, `Accepted by the vendor (${new URL(url).hostname}, session passed on this slide): offset as measured, margin ${accepted.margin.toFixed(2)}.`)}`);
      }
      for (const record of result.rounds) {
        const expected = values.accept && passed && !record.error && !record.errorsAfter?.length ? acceptedExpected(record) : null;
        const label = expected ? { expected, notes: `Accepted by the vendor (${new URL(url).hostname}, session passed, no error after this round): auto-labeled with the answer ${config.model} gave.` } : undefined;
        const dir = saveRound(record, config.model, label);
        console.log(`  round ${record.round}: ${record.actions.length} actions, errors after: ${JSON.stringify(record.errorsAfter ?? [])} → ${dir}`);
      }
      await host.dispose();
    }
  }
} finally {
  await browser.close();
}
