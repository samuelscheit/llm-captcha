import type { AdapterSpec } from "../types";

const RECAPTCHA = String.raw`(google\.com|recaptcha\.net)/recaptcha/(api2|enterprise)`;

/** Google reCAPTCHA v2: the checkbox frame, the image challenge frame, its rate-limit screen. */
export const GOOGLE: AdapterSpec[] = [
  {
    id: "recaptcha-checkbox",
    kind: "checkbox",
    url: `${RECAPTCHA}/anchor`,
    root: "#rc-anchor-container",
    solved: '#recaptcha-anchor[aria-checked="true"]',
    waiting: ".recaptcha-checkbox-loading, .recaptcha-checkbox-spinner-overlay[style*='opacity: 1']",
    // "Verification expired. Check the checkbox again." shows in the same place and is recoverable.
    blockedText: "(try again later|automated queries)",
    targets: [{ id: "checkbox", selector: "#recaptcha-anchor" }],
  },
  {
    // reCAPTCHA's rate-limit screen replaces the image challenge in the same frame.
    id: "recaptcha-blocked",
    kind: "checkbox",
    url: `${RECAPTCHA}/bframe`,
    root: ".rc-doscaptcha-body, .rc-doscaptcha-header",
    blocked: ".rc-doscaptcha-header",
    targets: [],
  },
  {
    id: "recaptcha-images",
    kind: "select",
    url: `${RECAPTCHA}/bframe`,
    root: "#rc-imageselect",
    instruction: [".rc-imageselect-desc-wrapper", ".rc-imageselect-instructions"],
    errors: [
      ".rc-imageselect-incorrect-response",
      ".rc-imageselect-error-select-more",
      ".rc-imageselect-error-dynamic-more",
      ".rc-imageselect-error-select-something",
    ],
    blocked: ".rc-doscaptcha-header",
    targets: [
      { id: "t", selector: "td.rc-imageselect-tile", all: true, selected: ".rc-imageselect-tileselected" },
      { id: "verify", selector: "#recaptcha-verify-button", labelFromText: true },
      { id: "reload", selector: "#recaptcha-reload-button", optional: true },
    ],
  },
];
