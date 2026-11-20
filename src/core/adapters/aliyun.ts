import type { AdapterSpec } from "../types";

/** Alibaba Cloud: AliyunCaptcha 2.0 (puzzle and slide) and the older "nocaptcha" (nc_) slider. */
export const ALIYUN: AdapterSpec[] = [
  {
    // AliyunCaptcha 2.0, puzzle: the piece is a full-height strip (shape in its alpha channel)
    // dragged along by the handle; the gap is drawn lighter than its surround.
    id: "aliyun-puzzle",
    kind: "slider",
    root: "#aliyunCaptcha-img",
    instruction: ["#aliyunCaptcha-sliding-text"],
    targets: [
      { id: "background", selector: "#aliyunCaptcha-img" },
      { id: "piece", selector: "#aliyunCaptcha-puzzle" },
      { id: "handle", selector: "#aliyunCaptcha-sliding-slider" },
    ],
  },
  {
    // AliyunCaptcha 2.0, slide to the end ("Please slide to verify", e.g. Alibaba Cloud's
    // password reset). On a pass the handle goes and the bar reads "Verified"; the wrapper stays.
    id: "aliyun-slide",
    kind: "slider",
    root: "body:not(:has(#aliyunCaptcha-puzzle)) #aliyunCaptcha-sliding-wrapper",
    instruction: ["#aliyunCaptcha-sliding-text"],
    solvedText: "^(verified|验证通过|驗證通過)$",
    targets: [
      { id: "handle", selector: "#aliyunCaptcha-sliding-slider", optional: true },
      { id: "rail", selector: "#aliyunCaptcha-sliding-body" },
    ],
  },
  {
    // Alibaba's older "nocaptcha" (nc_) slider, rendered into login and registration forms. A
    // refused drag replaces the handle with "error, click to refresh".
    id: "aliyun-nc",
    kind: "slider",
    root: ".nc_scale",
    instruction: [".nc_scale .scale_text"],
    solved: ".nc_scale .btn_ok, [data-nc-lang='_yesTEXT']",
    // After a slide, while Aliyun's verdict loads: sliding again would restart the check.
    waiting: ".nc_scale .nc-loading-circle",
    targets: [
      { id: "handle", selector: ".nc_scale .btn_slide", optional: true },
      { id: "rail", selector: ".nc_scale" },
      { id: "reload", selector: ".nc_wrapper .errloading", optional: true },
    ],
  },
];
