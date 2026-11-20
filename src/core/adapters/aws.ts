import type { AdapterSpec } from "../types";

/** AWS WAF CAPTCHA: `<awswaf-captcha>` in the page, an open shadow root, a 3×3 image grid. */
export const AWS: AdapterSpec[] = [
  {
    id: "awswaf-grid",
    kind: "select",
    pierce: true,
    root: ".amzn-captcha-modal",
    instruction: ["#amzn-grid-instructions"],
    errors: ["[role=alert] p"],
    // While verifying, Confirm loses its id and shows a spinner.
    waiting: ".amzn-captcha-spinner",
    targets: [
      { id: "t", selector: "button.amzn-grid-cell", all: true, selected: '[aria-checked="true"]' },
      { id: "verify", selector: ".amzn-captcha-modal button.btn-primary", labelFromText: true },
      { id: "reload", selector: "#amzn-btn-refresh-internal", optional: true },
    ],
  },
];
