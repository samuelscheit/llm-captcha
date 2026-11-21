// Live: the real Tencent TCaptcha (network, third party). Run with `bun run live`, not in `check`.
import { expect, it } from "vitest";
import { BUILTIN_ADAPTERS } from "../../src/core/adapters";
import { solve } from "../../src/core/engine";
import { CdpDriver } from "../../src/cdp/driver";
import { playwrightHost } from "../../src/cdp/playwright";
import { launch } from "../../src/tools/browser";
import { openVendorPage, VENDOR_PAGES } from "../../src/tools/vendor-pages";

it("solves the real Tencent slide puzzle and gets a ticket [tencent-slider]", async () => {
  const b = await launch();
  const page = b.context.pages()[0]!;
  try {
    await openVendorPage(b.context, page, VENDOR_PAGES.tencent);
    const host = await playwrightHost(page);
    try {
      const result = await solve(new CdpDriver(host), { adapters: BUILTIN_ADAPTERS, maxRounds: 4, timeoutMs: 60_000 });
      expect(result.state, result.detail).toBe("solved");
    } finally {
      await host.dispose();
    }
    // The page's own callback got a real ticket.
    await expect.poll(() => page.title(), { timeout: 10_000 }).toMatch(/^cb:.*"ret":0,"ticket":"tr/);
  } finally {
    await b.close();
  }
});
