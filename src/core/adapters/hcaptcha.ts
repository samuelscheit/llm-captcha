import type { AdapterSpec } from "../types";

/** hCaptcha: the checkbox frame and the challenge frame (canvas tasks, animated). */
export const HCAPTCHA: AdapterSpec[] = [
  {
    id: "hcaptcha-checkbox",
    kind: "checkbox",
    url: String.raw`hcaptcha\.com/captcha/.*frame=checkbox`,
    root: "#anchor",
    solved: '#checkbox[aria-checked="true"]',
    response: "textarea[name=h-captcha-response]",
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
];
