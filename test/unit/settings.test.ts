import { describe, expect, it } from "vitest";
import { BUILTIN_ADAPTERS } from "../../src/core/adapters";
import { DEFAULT_SETTINGS, adaptersOf, isDenied } from "../../src/extension/settings";

describe("denylist", () => {
  const s = { ...DEFAULT_SETTINGS, denylist: ["bank.example", "*.corp.test", " .gov.test ", ""] };
  it.each([
    ["https://bank.example/login", true],
    ["https://www.bank.example/", true],
    ["https://notbank.example/", false],
    ["https://a.b.corp.test/", true],
    ["https://corp.test/", true],
    ["https://x.gov.test/", true],
    ["https://example.com/", false],
    ["not a url", false],
  ])("%s → %s", (url, denied) => expect(isDenied(s, url)).toBe(denied));
});

describe("adapters", () => {
  it("puts custom adapters before the built-ins", () => {
    const custom = { id: "mine", kind: "select" as const, root: "#x", targets: [] };
    expect(adaptersOf({ ...DEFAULT_SETTINGS, customAdapters: [custom] }).map((a) => a.id)).toEqual(["mine", ...BUILTIN_ADAPTERS.map((a) => a.id)]);
  });

  const urlOf = (id: string) => new RegExp(BUILTIN_ADAPTERS.find((a) => a.id === id)!.url!, "i");
  it.each([
    ["recaptcha-checkbox", "https://www.google.com/recaptcha/api2/anchor?ar=1&k=x", true],
    ["recaptcha-checkbox", "https://www.recaptcha.net/recaptcha/enterprise/anchor?k=x", true],
    ["recaptcha-images", "https://www.google.com/recaptcha/api2/bframe?hl=en", true],
    ["recaptcha-images", "https://www.google.com/recaptcha/api2/anchor?ar=1", false],
    ["hcaptcha-checkbox", "https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html#frame=checkbox&id=1", true],
    ["hcaptcha-challenge", "https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html#frame=challenge&id=1", true],
    ["hcaptcha-challenge", "https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html#frame=checkbox", false],
    ["turnstile", "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/f/av0/rch/x", true],
    ["tencent-slider", "https://turing.captcha.qcloud.com/cap_union_new_show?aid=1&protocol=https", true],
    ["tencent-slider", "https://t.captcha.qcloud.com/cap_union_new_show?aid=1", true],
    ["datadome-slider", "https://geo.captcha-delivery.com/captcha/?initialCid=x&hash=y", true],
    ["datadome-slider", "https://shop.example/captcha/", false],
    ["text-image", "https://geo.captcha-delivery.com/captcha/?initialCid=x", false],
    ["text-image", "https://turing.captcha.qcloud.com/cap_union_new_show?aid=1", false],
    ["text-image", "https://shop.example/login", true],
    ["text-image", "https://www.google.com/recaptcha/api2/bframe", false],
    ["text-image", "https://challenges.cloudflare.com/x", false],
  ])("%s matches %s: %s", (id, url, match) => expect(urlOf(id).test(url)).toBe(match));
});
