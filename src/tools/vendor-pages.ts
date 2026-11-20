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
  /** Script run in every frame before the page's own (e.g. GeeTest's demo config in localStorage). */
  init?: string;
  /** Load event to wait for; some demo pages never fire `load`. */
  waitUntil?: "load" | "domcontentloaded";
  /** Clicked (in any frame, in order) before the fill and the trigger: tabs choosing a variant. */
  clicks?: string[];
  /** Typed into fields before the trigger: [selector, value]. */
  fill?: [string, string][];
  /** Clicked to open the widget at all (a "Verify" or "Send code" button). */
  trigger?: string;
  /** Clicked, in any frame, to bring the challenge itself up for inspection (the solver does this live). */
  reveal?: string[];
  /**
   * Matches (in any frame, at any moment) once the vendor accepted an answer. For widgets that
   * pass and reset at once (Shumei loads a new puzzle 0.6 s after a pass), live tests watch it.
   */
  passed?: string;
}

/** Init script for GeeTest v4's demo: which challenge type it shows (word and phrase need Chinese). */
function geetestV4(riskType: string, language = "en"): string {
  const config = JSON.stringify({ language, riskType, product: "float", captchaId: "54088bb07d2df3c46b79f80300b0abbe" });
  return `if (location.host === "gt4.geetest.com") localStorage.setItem("geetest_config", ${JSON.stringify(config)});`;
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
  /**
   * GNAME's abuse form: "Send code" opens its GnSliderVerify slider (scored at /request/slideverify).
   * The address is a black hole: the code goes nowhere.
   */
  gname: {
    url: "https://www.gname.com/abuse/category/2",
    fill: [["input[name=email]", "captcha-solver-test@example.com"]],
    trigger: "a.get_code",
  },
  /**
   * Alibaba Cloud's sign-in, with an account that does not exist: its risk control puts the
   * "nocaptcha" (nc_) slider into the form when it wants a check.
   */
  alibaba: {
    url: "https://account.alibabacloud.com/login/login.htm",
    fill: [
      ["iframe#alibaba-login-box >> internal:control=enter-frame >> #fm-login-id", "captcha-solver-test@example.com"],
      ["iframe#alibaba-login-box >> internal:control=enter-frame >> #fm-login-password", "not-a-real-password-1"],
    ],
    trigger: "#fm-login-submit",
  },
  /** Alibaba Cloud's password reset: AliyunCaptcha 2.0 ("Please slide to verify") shows right away. */
  "alibaba-reset": { url: "https://account.alibabacloud.com/reset_password/reset_password.htm?fromSite=6&lang=en_US" },
  /** Aliyun's "nocaptcha" (nc_) slider itself, with the public test appkey of Aliyun's own demos. */
  "aliyun-nc": {
    url: "https://nc-test.example.com/",
    html: widgetPage(
      '<script src="https://g.alicdn.com/AWSC/AWSC/awsc.js"></script>',
      `<div id="nc"></div><script>AWSC.use("nc", (state, module) => { window.nc = module.init({ appkey: "CF_APP_1", scene: "nc_login", renderTo: "nc",
  success: (data) => { document.title = "ok:" + JSON.stringify(data) }, fail: (code) => { document.title = "fail:" + code }, error: (e) => { document.title = "error:" + e } }) })</script>`,
    ),
  },
  /** GeeTest v3's slide demo: the radar button opens a canvas slide puzzle. */
  "geetest-v3": { url: "https://demos.geetest.com/slide-float.html", trigger: ".geetest_radar_tip", passed: ".geetest_radar_success" },
  /** GeeTest v4's demo, slide puzzle (the type comes from localStorage before its script loads). */
  "geetest-v4": {
    url: "https://gt4.geetest.com/",
    init: geetestV4("slide"),
    trigger: ".geetest_btn_click",
    passed: ".geetest_captcha.geetest_lock_success",
  },
  /** GeeTest v4's "select 3 images with [icon]" (model). */
  "geetest-v4-nine": {
    url: "https://gt4.geetest.com/",
    init: geetestV4("nine"),
    trigger: ".geetest_btn_click",
    passed: ".geetest_captcha.geetest_lock_success",
  },
  /** GeeTest v4's icon task: click the icons in the order the header shows (model). */
  "geetest-v4-icon": { url: "https://gt4.geetest.com/", init: geetestV4("icon"), trigger: ".geetest_btn_click", passed: ".geetest_captcha.geetest_lock_success" },
  /** GeeTest v4's word task: click the characters in order (model, Chinese). */
  "geetest-v4-word": { url: "https://gt4.geetest.com/", init: geetestV4("word", "zho"), trigger: ".geetest_btn_click", passed: ".geetest_captcha.geetest_lock_success" },
  /** GeeTest v4's phrase task: click the characters of the phrase in order (model, Chinese). */
  "geetest-v4-phrase": { url: "https://gt4.geetest.com/", init: geetestV4("phrase", "zho"), trigger: ".geetest_btn_click", passed: ".geetest_captcha.geetest_lock_success" },
  /** GeeTest v3's click task: click the icons in the order shown, then confirm (model). */
  "geetest-v3-click": { url: "https://demos.geetest.com/click-float.html", trigger: ".geetest_radar_tip", passed: ".geetest_radar_success" },
  /** GeeTest v4's IconCrush: swap two items to line up three (model). */
  "geetest-v4-match": { url: "https://gt4.geetest.com/", init: geetestV4("match"), trigger: ".geetest_btn_click", passed: ".geetest_captcha.geetest_lock_success" },
  /** GeeTest v4's gobang: move one ball to line up five (model). */
  "geetest-v4-gobang": { url: "https://gt4.geetest.com/", init: geetestV4("winlinze"), trigger: ".geetest_btn_click", passed: ".geetest_captcha.geetest_lock_success" },
  /** NetEase Yidun's jigsaw trial, in its default float mode (images show under the pointer). */
  yidun: { url: "https://dun.163.com/trial/jigsaw", passed: ".yidun.yidun--jigsaw.yidun--success" },
  /** Shumei's slider trial (float mode); a new puzzle follows each pass at once. */
  shumei: { url: "https://www.ishumei.com/trial/captcha.html", passed: ".shumei_captcha_slide_wrapper.slide_success" },
  /** Dingxiang's slide puzzle demo: choose the tab, then its bar opens the puzzle. */
  dingxiang: {
    url: "https://www.dingxiang-inc.com/business/captcha",
    waitUntil: "domcontentloaded",
    clicks: [".captcha-intro-tabs >> text=滑动拼图"],
    passed: ".dx_captcha_oneclick_bar.dx-success",
  },
  /** Arkose Labs (FunCaptcha) with GitLab's sign-up key, served under gitlab.com. */
  arkose: {
    url: "https://gitlab.com/__captcha_test",
    html: widgetPage(
      `<script src="https://gitlab-api.arkoselabs.com/v2/12D76D4C-5EDF-4EB4-A84D-042C497A9610/api.js" data-callback="setup" async defer></script>`,
      `<div id="ark"></div><script>function setup(e) { e.setConfig({ selector: "#ark", mode: "inline", onCompleted: (r) => { document.title = "ok:" + r.token }, onError: (r) => { document.title = "error:" + JSON.stringify(r) } }) }</script>`,
    ),
    passed: ".screen.victory",
  },
  /** Yandex SmartCaptcha's demo: the checkbox opens the text task. */
  yandex: { url: "https://captcha-api.yandex.ru/demo", passed: '.CheckboxCaptcha #js-button[aria-checked="true"]' },
  /** MTCaptcha's demo (its public demo key); verifies by itself once typed. */
  mtcaptcha: { url: "https://service.mtcaptcha.com/mtcv1/demo/index.html", passed: '.mtcap-statusbutton[aria-hidden="true"]' },
  /** Friendly Captcha v2 on its playground (below the fold). */
  "friendlycaptcha-v2": { url: "https://developer.friendlycaptcha.com/playground", passed: ".main.state-completed" },
  /** Friendly Captcha v1 on the same playground. */
  "friendlycaptcha-v1": { url: "https://developer.friendlycaptcha.com/playground?settings=eyJ2ZXJzaW9uIjoidjEifQ%3D%3D", passed: ".frc-container.frc-success" },
  /** ALTCHA's home page (its first widget runs in test mode). */
  altcha: { url: "https://altcha.org/", passed: 'altcha-widget .altcha[data-state="verified"]' },
  /** mCaptcha's widget with the docs' demo site key, in a page of our own. */
  mcaptcha: {
    url: "https://mcaptcha-test.example.com/",
    html: widgetPage(
      "",
      `<iframe src="https://demo.mcaptcha.org/widget/?sitekey=pHy0AktWyOKuxZDzFfoaewncWecCHo23" sandbox="allow-same-origin allow-scripts allow-popups" width="340" height="80" style="border:0"></iframe>`,
    ),
    passed: '#widget__verification-checkbox[aria-checked="true"]',
  },
  /** Anubis's own deployment: a proof-of-work interstitial in front of its docs. */
  anubis: { url: "https://anubis.techaro.lol/" },
  /** HUMAN (PerimeterX) Press & Hold on Walmart's block page. */
  human: { url: "https://www.walmart.com/blocked", passed: ".fetching-volume.draw, #checkmark.draw" },
  /** Eranet's phishing report form: "Send Code" opens its slider. Same black-hole address. */
  eranet: {
    url: "https://www.eranet.com/panel/abuse/report/phishing-report/index",
    fill: [["#phishingReport_email", "captcha-solver-test@example.com"]],
    trigger: "button.send-code-btn",
  },
} satisfies Record<string, VendorPage>;

export type VendorName = keyof typeof VENDOR_PAGES;

export function vendorPage(name: string): VendorPage {
  const page = (VENDOR_PAGES as Record<string, VendorPage>)[name];
  if (!page) throw new Error(`Unknown vendor page "${name}": ${Object.keys(VENDOR_PAGES).join(", ")}`);
  return page;
}

/**
 * Init script, in every frame: remember whether `selector` ever matched, as an attribute on the
 * root element (readable from any world, which a page global is not).
 */
function watchPassed(selector: string): void {
  const check = () => {
    if (document.querySelector(selector)) document.documentElement.setAttribute("data-captcha-vendor-passed", "");
  };
  new MutationObserver(check).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "aria-checked", "data-state", "style"] });
}

/** Whether the vendor page's `passed` selector matched in any frame since it loaded. */
export async function vendorPassed(page: Page): Promise<boolean> {
  for (const frame of page.frames()) {
    if (await frame.evaluate(() => document.documentElement.hasAttribute("data-captcha-vendor-passed")).catch(() => false)) return true;
  }
  return false;
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
  if (vendor.init) await context.addInitScript(vendor.init);
  if (vendor.passed) await context.addInitScript(watchPassed, vendor.passed);
  await page.goto(vendor.url, { waitUntil: vendor.waitUntil ?? "load" });
  for (const selector of vendor.clicks ?? []) {
    await clickInAnyFrame(page, selector);
    await page.waitForTimeout(800);
  }
  for (const [selector, value] of vendor.fill ?? []) await page.locator(selector).first().fill(value);
  for (const selector of [...(vendor.trigger ? [vendor.trigger] : []), ...(options.reveal ? (vendor.reveal ?? []) : [])]) {
    await clickInAnyFrame(page, selector);
    await page.waitForTimeout(1000);
  }
}
