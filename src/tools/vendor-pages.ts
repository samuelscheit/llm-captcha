/**
 * Where each vendor's real challenge can be brought up, for `explore`, `capture` and the live
 * tests. Vendors bind site keys to domains: a page of our own is served (through request routing)
 * under a URL of the domain its key belongs to, while the widget and everything it loads stay real.
 */
import type { BrowserContext, Page } from "patchright";

export interface VendorPage {
  /** Where the page lives, or is served when `html` is given; its domain is what the vendor checks. */
  url: string;
  /** Our own page, served at `url`; without it the real page at `url` loads. */
  html?: string;
  /** Clicked to open the widget at all (a "Verify" button). */
  trigger?: string;
  /** Clicked, in any frame, to bring the challenge itself up for inspection (the solver does this live). */
  reveal?: string[];
}

const widgetPage = (head: string, body: string) => `<!doctype html><html><head><meta charset="utf-8">${head}</head><body style="font:15px system-ui;margin:24px">${body}</body></html>`;

export const VENDOR_PAGES = {
  /** Google's reCAPTCHA v2 demo; under automation the checkbox opens an image challenge. */
  recaptcha: { url: "https://www.google.com/recaptcha/api2/demo", reveal: ["#recaptcha-anchor"] },
  /** hCaptcha's demo; the checkbox opens a (canvas, animated) challenge. */
  hcaptcha: { url: "https://accounts.hcaptcha.com/demo", reveal: ["#checkbox"] },
  /** Cloudflare Turnstile with the test site key that always shows the interactive checkbox. */
  turnstile: {
    url: "https://turnstile.example.com/",
    html: widgetPage(
      '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>',
      '<form><div class="cf-turnstile" data-sitekey="3x00000000000000000000FF"></div></form>',
    ),
  },
  /** Tencent TCaptcha with the app id of tencentcloud.com's own report form; its slide puzzle opens on "Verify". */
  tencent: {
    url: "https://www.tencentcloud.com/__captcha_test",
    html: widgetPage(
      '<script src="https://turing.captcha.qcloud.com/TCaptcha.js"></script>',
      `<button id="go">Verify</button><script>go.onclick = () => new TencentCaptcha('2070586963', (r) => { document.title = 'cb:' + JSON.stringify(r) }).show()</script>`,
    ),
    trigger: "#go",
  },
} satisfies Record<string, VendorPage>;

export type VendorName = keyof typeof VENDOR_PAGES;

export function vendorPage(name: string): VendorPage {
  const page = (VENDOR_PAGES as Record<string, VendorPage>)[name];
  if (!page) throw new Error(`Unknown vendor page "${name}": ${Object.keys(VENDOR_PAGES).join(", ")}`);
  return page;
}

/** Click `selector` in the first frame that has it: widgets open their own frames. */
export async function clickInAnyFrame(page: Page, selector: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const frame of page.frames()) {
      if (await frame.locator(selector).count().catch(() => 0)) return frame.locator(selector).first().click();
    }
    if (Date.now() > deadline) throw new Error(`Nothing matches ${selector} in any frame.`);
    await page.waitForTimeout(250);
  }
}

/**
 * Open a vendor page in `page`: serve our own page at its URL when it has one, load it, and click
 * its trigger. With `reveal`, also click through to the challenge itself.
 */
export async function openVendorPage(context: BrowserContext, page: Page, vendor: VendorPage, options: { reveal?: boolean } = {}): Promise<void> {
  if (vendor.html) await context.route(vendor.url, (route) => route.fulfill({ contentType: "text/html", body: vendor.html! }));
  await page.goto(vendor.url);
  for (const selector of [...(vendor.trigger ? [vendor.trigger] : []), ...(options.reveal ? (vendor.reveal ?? []) : [])]) {
    await clickInAnyFrame(page, selector);
    await page.waitForTimeout(1000);
  }
}
