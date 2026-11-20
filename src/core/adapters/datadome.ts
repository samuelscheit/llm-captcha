import type { AdapterSpec } from "../types";

const FRAME = String.raw`captcha-delivery\.com/captcha`;

/** DataDome: its challenge frame's slider, and its refusal page. */
export const DATADOME: AdapterSpec[] = [
  {
    // The `simple` variant only (slide to the target at the end). The puzzle variant needs a gap
    // in a canvas and is left alone.
    id: "datadome-slider",
    kind: "slider",
    url: FRAME,
    root: "#captcha__frame.simple .sliderContainer",
    solved: ".sliderContainer.slider-success",
    targets: [
      { id: "handle", selector: "#captcha__frame.simple .slider" },
      { id: "rail", selector: "#captcha__frame.simple .sliderContainer" },
    ],
  },
  {
    // "Access is temporarily restricted" (the IP or device is blocked): nothing to solve; the
    // session ends as blocked instead of waiting.
    id: "datadome-blocked",
    kind: "checkbox",
    url: FRAME,
    // The refusal page has no captcha frame; the slider page does.
    root: "body:not(:has(#captcha__frame))",
    blockedText: "^(access is temporarily restricted|you have been blocked|access blocked)",
    targets: [],
  },
];
