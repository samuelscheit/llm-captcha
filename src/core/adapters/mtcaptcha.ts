import type { AdapterSpec } from "../types";

/** MTCaptcha: a text image (CSS background) that verifies by itself once typed. */
export const MTCAPTCHA: AdapterSpec[] = [
  {
    id: "mtcaptcha",
    kind: "text",
    url: String.raw`mtcaptcha\.com/mtcv1/client/iframe\.html`,
    root: ".mtcap-card:not(.error-card)",
    solved: '.mtcap-statusbutton[aria-hidden="true"]',
    // A wrong answer is only said in screen-reader text, then a new image comes.
    errorsHidden: ["[id^=desc4CaptchaStatus]"],
    targets: [
      { id: "input", selector: ".mtcap-inputtext" },
      { id: "reload", selector: ".mtcap-statusbutton", optional: true },
    ],
  },
];
