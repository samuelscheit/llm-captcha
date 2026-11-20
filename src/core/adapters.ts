import type { AdapterSpec } from "./types";

const PROVIDER_FRAMES = String.raw`google\.com/recaptcha|recaptcha\.net/recaptcha|hcaptcha\.com/captcha|challenges\.cloudflare\.com|/cap_union_new_show`;

/** Built-in adapters. User adapters (settings) use the same format and are checked first. */
export const BUILTIN_ADAPTERS: AdapterSpec[] = [
  {
    id: "recaptcha-checkbox",
    kind: "checkbox",
    url: String.raw`(google\.com|recaptcha\.net)/recaptcha/(api2|enterprise)/anchor`,
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
    url: String.raw`(google\.com|recaptcha\.net)/recaptcha/(api2|enterprise)/bframe`,
    root: ".rc-doscaptcha-body, .rc-doscaptcha-header",
    blocked: ".rc-doscaptcha-header",
    targets: [],
  },
  {
    id: "recaptcha-images",
    kind: "select",
    url: String.raw`(google\.com|recaptcha\.net)/recaptcha/(api2|enterprise)/bframe`,
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
  {
    id: "hcaptcha-checkbox",
    kind: "checkbox",
    url: String.raw`hcaptcha\.com/captcha/.*frame=checkbox`,
    root: "#anchor",
    solved: '#checkbox[aria-checked="true"]',
    waiting: "#anchor-state .pulse:not([style*='display: none'])",
    targets: [{ id: "checkbox", selector: "#checkbox" }],
  },
  {
    id: "hcaptcha-challenge",
    kind: "point",
    url: String.raw`hcaptcha\.com/captcha/.*frame=challenge`,
    root: "body:has(.challenge-view)",
    instruction: [".prompt-text", ".challenge-example + .prompt-text"],
    errors: [".display-error"],
    targets: [
      { id: "t", selector: ".task-grid .task", all: true, optional: true, selected: '[aria-pressed="true"]' },
      { id: "submit", selector: ".button-submit", labelFromText: true },
      { id: "refresh", selector: ".refresh.button", optional: true },
    ],
  },
  {
    id: "turnstile",
    kind: "checkbox",
    url: String.raw`challenges\.cloudflare\.com`,
    pierce: true,
    root: ".main-wrapper",
    retryMs: 8000,
    // Without the checkbox the widget is verifying, or retrying a failure by itself: waiting.
    solvedText: "^Success!?$",
    targets: [{ id: "checkbox", selector: "label:has(input[type=checkbox])", optional: true }],
  },
  {
    // Tencent TCaptcha slide puzzle. Its frame: turing.captcha.qcloud.com (or t.captcha.qcloud.com)/cap_union_new_show.
    id: "tencent-slider",
    kind: "slider",
    url: String.raw`/cap_union_new_show`,
    root: "#tcOperation",
    instruction: ["#guideText"],
    errors: ["#statusError", "#statusFail"],
    solved: ".tc-cover.tc-success",
    retryMs: 2500,
    targets: [
      { id: "background", selector: "#slideBg" },
      { id: "piece", selector: "#slideBlock" },
      { id: "handle", selector: "#tcaptcha_drag_button" },
      { id: "reload", selector: "#reload", optional: true },
    ],
  },
  {
    id: "text-image",
    kind: "text",
    url: `^(?!.*(${PROVIDER_FRAMES}))`,
    root: ['img', 'canvas']
      .flatMap((tag) => ["src", "alt", "id", "class", "name"].map((attr) => `${tag}[${attr}*="captcha" i]`))
      .join(", "),
    targets: [
      {
        id: "input",
        selector: ["name", "id", "placeholder", "aria-label", "class"]
          .map((attr) => `input[${attr}*="captcha" i]:not([type=hidden])`)
          .join(", "),
      },
    ],
  },
];
