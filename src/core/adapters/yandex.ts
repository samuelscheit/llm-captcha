import type { AdapterSpec } from "../types";

/** Yandex SmartCaptcha: the checkbox (frame or showcaptcha page), the text task popup. */
export const YANDEX: AdapterSpec[] = [
  {
    id: "yandex-checkbox",
    kind: "checkbox",
    root: ".CheckboxCaptcha",
    solved: '.CheckboxCaptcha #js-button[aria-checked="true"]',
    targets: [{ id: "checkbox", selector: '.CheckboxCaptcha #js-button[role=checkbox][aria-checked="false"]', optional: true }],
  },
  {
    // "Enter the code from the image": two curved words; a wrong answer loads a new image.
    id: "yandex-text",
    kind: "text",
    root: ".AdvancedCaptcha_image:not(.AdvancedCaptcha_audio) .AdvancedCaptcha-View",
    instruction: [".AdvancedCaptcha-FormLabel"],
    errors: [".Textinput-Hint"],
    waiting: ".CaptchaButton_progress",
    targets: [
      { id: "input", selector: ".AdvancedCaptcha .Textinput-Control[name=rep]" },
      { id: "submit", selector: ".AdvancedCaptcha_submit" },
      { id: "reload", selector: ".AdvancedCaptcha [data-testid=refresh]", optional: true },
    ],
  },
];
