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
 */
import { parseArgs } from "node:util";
import { BUILTIN_ADAPTERS } from "../core/adapters";
import { solve } from "../core/engine";
import { createModel } from "../core/solver";
import { CdpDriver } from "../cdp/driver";
import { playwrightHost } from "../cdp/playwright";
import { launch } from "./browser";
import { liveModel } from "./model";
import { saveRound } from "./fixtures";
import { openVendorPage, vendorPage, type VendorPage } from "./vendor-pages";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { sessions: { type: "string", default: "1" }, vendor: { type: "string", multiple: true, default: [] } },
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
      let result = await solve(driver, { adapters: BUILTIN_ADAPTERS, models: [model] });
      for (let i = 0; result.state === "idle" && i < 10; i++) {
        await page.waitForTimeout(1000);
        result = await solve(driver, { adapters: BUILTIN_ADAPTERS, models: [model] });
      }
      console.log(`${url} #${session}: ${result.state} (${result.detail}), ${result.rounds.length} model rounds`);
      for (const record of result.rounds) {
        const dir = saveRound(record, config.model);
        console.log(`  round ${record.round}: ${record.actions.length} actions, errors after: ${JSON.stringify(record.errorsAfter ?? [])} → ${dir}`);
      }
      await host.dispose();
    }
  }
} finally {
  await browser.close();
}
