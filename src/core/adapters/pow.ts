import type { AdapterSpec } from "../types";

/**
 * Proof-of-work checks: the browser computes, nobody looks at images. Some need a click to
 * start (Friendly Captcha, ALTCHA, mCaptcha); interstitials run by themselves and move on (Anubis).
 */
export const POW: AdapterSpec[] = [
  {
    id: "friendlycaptcha-v2",
    kind: "checkbox",
    url: String.raw`frcapi\.com/api/v2/captcha/widget`,
    root: ".main",
    solved: ".main.state-completed",
    errors: [".main.state-error .error-text"],
    targets: [{ id: "checkbox", selector: '.main:not(.state-completed) button[role=checkbox][aria-checked="false"]', optional: true }],
  },
  {
    id: "friendlycaptcha-v1",
    kind: "checkbox",
    root: ".frc-captcha:has(.frc-container)",
    solved: ".frc-container.frc-success",
    waiting: ".frc-captcha .frc-progress",
    errors: [".frc-container.frc-error .frc-text"],
    targets: [{ id: "checkbox", selector: ".frc-captcha .frc-button", optional: true }],
  },
  {
    // The token input is filled even on failure: state comes from data-state only.
    id: "altcha",
    kind: "checkbox",
    root: "altcha-widget .altcha",
    solved: 'altcha-widget .altcha[data-state="verified"]',
    waiting: 'altcha-widget .altcha[data-state="verifying"]',
    errors: ['altcha-widget .altcha[data-state="error"] .altcha-error'],
    targets: [
      {
        id: "checkbox",
        selector: 'altcha-widget .altcha:is([data-state="unverified"],[data-state="error"],[data-state="expired"]) .altcha-checkbox-wrap > :first-child',
        optional: true,
      },
    ],
  },
  {
    // ALTCHA's code-image fallback, when its server wants more than proof of work.
    id: "altcha-code",
    kind: "text",
    root: "altcha-widget .altcha-popover:has(.altcha-code-challenge)",
    instruction: [".altcha-code-challenge-text"],
    errors: ["altcha-widget .altcha-error"],
    solved: 'altcha-widget .altcha[data-state="verified"]',
    targets: [
      { id: "input", selector: ".altcha-code-challenge input.altcha-input" },
      { id: "verify", selector: ".altcha-code-challenge button[type=submit]", labelFromText: true },
      { id: "reload", selector: ".altcha-code-challenge button[aria-label=Reload]", optional: true },
    ],
  },
  {
    id: "mcaptcha",
    kind: "checkbox",
    url: String.raw`/widget/?\?sitekey=`,
    root: ".widget__verification-container",
    solved: '#widget__verification-checkbox[aria-checked="true"]',
    solvedText: "^Verified!$",
    targets: [{ id: "checkbox", selector: '#widget__verification-checkbox[aria-checked="false"]:not([aria-valuetext="Processing..."])', optional: true }],
  },
  {
    // Anubis ("Making sure you're not a bot!"): computes, sets a cookie, reloads into the site.
    id: "anubis",
    kind: "checkbox",
    root: "html:has(#anubis_challenge) main",
    blockedText: "^oh noes!?$",
    targets: [],
  },
];
