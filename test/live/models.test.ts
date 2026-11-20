// Live: the model-solved challenges on their vendors' demos, with the live model from the
// environment (LLM_PROVIDER / LLM_BASE_URL / LLM_API_KEY / LLM_MODEL). Skipped without a key.
import { expect, it } from "vitest";
import { BUILTIN_ADAPTERS } from "../../src/core/adapters";
import { solve } from "../../src/core/engine";
import { createModel } from "../../src/core/solver";
import { CdpDriver } from "../../src/cdp/driver";
import { playwrightHost } from "../../src/cdp/playwright";
import { launch } from "../../src/tools/browser";
import { saveRound } from "../../src/tools/fixtures";
import { liveModel } from "../../src/tools/model";
import { openVendorPage, VENDOR_PAGES } from "../../src/tools/vendor-pages";

// Tagged with the model-solved challenge only: the checkbox is verified by the vendor test widgets.
it.skipIf(!process.env.LLM_API_KEY).each([
  ["recaptcha", "recaptcha-images"],
  ["hcaptcha", "hcaptcha-challenge"],
] as const)("solves the %s demo with the live model [%s]", async (vendor, _challenge) => {
  const b = await launch();
  const page = b.context.pages()[0]!;
  try {
    await openVendorPage(b.context, page, VENDOR_PAGES[vendor]);
    const host = await playwrightHost(page);
    try {
      const run = () => solve(new CdpDriver(host), { adapters: BUILTIN_ADAPTERS, models: [createModel(liveModel())], maxRounds: 8, timeoutMs: 180_000 });
      let result = await run();
      for (let i = 0; result.state === "idle" && i < 10; i++) {
        await page.waitForTimeout(1000);
        result = await run();
      }
      // A failure is evidence: its rounds go to fixtures/captured/ for labeling and replay.
      if (result.state !== "solved") for (const round of result.rounds) saveRound(round, liveModel().model);
      expect(result.state, result.detail).toBe("solved");
    } finally {
      await host.dispose();
    }
  } finally {
    await b.close();
  }
}, 240_000);
