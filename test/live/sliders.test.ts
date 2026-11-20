// Live: real sliders on the forms they guard (network, third parties). `bun run live`, not `check`.
// The forms ask for an emailed code; the address is a black hole (example.com).
import { expect, it } from "vitest";
import { BUILTIN_ADAPTERS } from "../../src/core/adapters";
import { solve } from "../../src/core/engine";
import { CdpDriver } from "../../src/cdp/driver";
import { playwrightHost } from "../../src/cdp/playwright";
import { launch } from "../../src/tools/browser";
import { openVendorPage, VENDOR_PAGES } from "../../src/tools/vendor-pages";

it("slides Aliyun's real nocaptcha slider once, and Aliyun's server passes it", async () => {
  const b = await launch();
  const page = b.context.pages()[0]!;
  // Aliyun judges the track server-side (analyze.jsonp): result.code 100 or 200 is a pass, 400
  // asks for more, 800 and 900 refuse. The demo key's widget stops at its loading step after
  // that, so the verdict itself is what this test reads.
  const verdicts: number[] = [];
  page.on("response", async (response) => {
    if (!response.url().includes("/nocaptcha/analyze.jsonp")) return;
    const code = /"code":(\d+)/.exec(await response.text().catch(() => ""));
    if (code) verdicts.push(Number(code[1]));
  });
  try {
    await openVendorPage(b.context, page, VENDOR_PAGES["aliyun-nc"]);
    await page.locator(".nc_scale .btn_slide").waitFor({ timeout: 20_000 });
    const host = await playwrightHost(page);
    try {
      await solve(new CdpDriver(host), { adapters: BUILTIN_ADAPTERS, maxRounds: 4, timeoutMs: 20_000 });
    } finally {
      await host.dispose();
    }
    expect(verdicts).toHaveLength(1);
    expect([100, 200]).toContain(verdicts[0]);
  } finally {
    await b.close();
  }
});

it.each([
  ["gname", ".gn-slide-rail"],
  ["eranet", "#dragHandler"],
] as const)("slides %s's real slider and the form goes on", async (name, slider) => {
  const b = await launch();
  const page = b.context.pages()[0]!;
  try {
    await openVendorPage(b.context, page, VENDOR_PAGES[name]);
    await page.locator(slider).first().waitFor({ timeout: 20_000 });
    const host = await playwrightHost(page);
    try {
      const result = await solve(new CdpDriver(host), { adapters: BUILTIN_ADAPTERS, maxRounds: 4, timeoutMs: 90_000 });
      expect(result.state, result.detail).toBe("solved");
    } finally {
      await host.dispose();
    }
    // The widget accepted the track and closed.
    await expect.poll(() => page.locator(slider).count(), { timeout: 15_000 }).toBe(0);
  } finally {
    await b.close();
  }
});
