import type { AdapterSpec } from "../types";

/** Tencent TCaptcha slide puzzle. Its frame: turing.captcha.qcloud.com (or t.captcha.qcloud.com)/cap_union_new_show. */
export const TENCENT: AdapterSpec[] = [
  {
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
];
