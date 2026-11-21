// Live: the providers' real widgets on their demos (network, third parties). `bun run live`.
// A run passes when the engine reports solved, or the vendor's own pass signal was seen (widgets
// like Shumei's show a new puzzle right after a pass). Model cases need LLM_API_KEY.
import { describe, expect, it } from "vitest";
import { BUILTIN_ADAPTERS } from "../../src/core/adapters";
import { solve, type SolveResult } from "../../src/core/engine";
import { createModel } from "../../src/core/solver";
import { CdpDriver } from "../../src/cdp/driver";
import { playwrightHost } from "../../src/cdp/playwright";
import { launch } from "../../src/tools/browser";
import { saveRound } from "../../src/tools/fixtures";
import { liveModel } from "../../src/tools/model";
import { openVendorPage, VENDOR_PAGES, vendorPassed, type VendorName } from "../../src/tools/vendor-pages";

/** "[a] [b]": adapter tags in a test title, for the coverage table. */
const tags = (ids: readonly string[]) => ids.map((id) => `[${id}]`).join(" ");

async function liveSolve(vendor: VendorName, withModel: boolean): Promise<{ result: SolveResult; passed: boolean }> {
  const b = await launch();
  const page = b.context.pages()[0]!;
  try {
    await openVendorPage(b.context, page, VENDOR_PAGES[vendor]);
    const host = await playwrightHost(page);
    try {
      const result = await solve(new CdpDriver(host), {
        adapters: BUILTIN_ADAPTERS,
        models: withModel ? [createModel(liveModel())] : [],
        maxRounds: withModel ? 8 : 4,
        timeoutMs: withModel ? 180_000 : 90_000,
      });
      const passed = result.state === "solved" || (await vendorPassed(page));
      // A failure is evidence: its model rounds go to fixtures/captured/ for labeling and replay.
      if (!passed && withModel) for (const round of result.rounds) saveRound(round, liveModel().model);
      return { result, passed };
    } finally {
      await host.dispose();
    }
  } finally {
    await b.close();
  }
}


describe("without a model", () => {
  it.each(([
    ["geetest-v3", ["geetest-v3-radar", "geetest-v3-slide"]],
    ["geetest-v4", ["geetest-v4-button", "geetest-v4-slide"]],
    ["yidun", ["yidun-jigsaw"]],
    ["shumei", ["shumei-slider"]],
    ["dingxiang", ["dingxiang-button", "dingxiang-slider"]],
    ["friendlycaptcha-v2", ["friendlycaptcha-v2"]],
    ["friendlycaptcha-v1", ["friendlycaptcha-v1"]],
    ["altcha", ["altcha"]],
    ["mcaptcha", ["mcaptcha"]],
    ["anubis", ["anubis"]],
    ["human", ["human-press-hold"]],
  ] as [VendorName, string[]][]).map(([vendor, ids]) => [vendor, tags(ids)] as const))("%s %s", async (vendor, _tags) => {
    const { result, passed } = await liveSolve(vendor, false);
    expect(passed, `${result.state}: ${result.detail}`).toBe(true);
  }, 150_000);
});

describe.skipIf(!process.env.LLM_API_KEY)("with the live model", () => {
  it.each(([
    ["geetest-v4-nine", ["geetest-v4-nine"]],
    ["yandex", ["yandex-text"]],
    ["mtcaptcha", ["mtcaptcha"]],
    ["arkose", ["arkose-game"]],
  ] as [VendorName, string[]][]).map(([vendor, ids]) => [vendor, tags(ids)] as const))("%s %s", async (vendor, _tags) => {
    const { result, passed } = await liveSolve(vendor, true);
    expect(passed, `${result.state}: ${result.detail}`).toBe(true);
  }, 240_000);
});

