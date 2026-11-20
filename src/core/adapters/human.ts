import type { AdapterSpec } from "../types";

/**
 * HUMAN (PerimeterX) "Press & Hold": inside a closed shadow root of #px-captcha, in iframes
 * without a URL of their own; ids and classes are random per load except these.
 */
export const HUMAN: AdapterSpec[] = [
  {
    id: "human-press-hold",
    kind: "hold",
    root: "div[role=button]:has(#checkmark)",
    solved: ".fetching-volume.draw, #checkmark.draw",
    targets: [
      { id: "handle", selector: "div[role=button]:has(#checkmark)" },
      { id: "progress", selector: "div[role=button]:has(#checkmark) > div:nth-child(2) > div:first-child", optional: true },
    ],
  },
];
