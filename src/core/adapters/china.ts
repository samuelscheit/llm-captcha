import type { AdapterSpec } from "../types";

/**
 * Slide puzzles of NetEase Yidun, Shumei and Dingxiang, all in the top document. Yidun and
 * Shumei default to float mode, where the images only show while the pointer is over the
 * slider: their images are optional, the engine hovers the handle to reveal them.
 */
export const CHINA: AdapterSpec[] = [
  {
    // Yidun (网易易盾): the piece lags its handle by about 10 px, measured during the drag.
    id: "yidun-jigsaw",
    kind: "slider",
    root: ".yidun.yidun--jigsaw:not(.yidun--success)",
    instruction: [".yidun--jigsaw .yidun_tips__text"],
    solved: ".yidun.yidun--jigsaw.yidun--success",
    waiting: ".yidun--jigsaw.yidun--loading, .yidun--jigsaw.yidun--verifying, .yidun--jigsaw.yidun--error",
    retryMs: 3000,
    targets: [
      { id: "background", selector: ".yidun--jigsaw img.yidun_bg-img", optional: true },
      { id: "piece", selector: ".yidun--jigsaw img.yidun_jigsaw", optional: true },
      { id: "handle", selector: ".yidun--jigsaw .yidun_slider" },
      { id: "reload", selector: ".yidun--jigsaw .yidun_refresh", optional: true },
    ],
  },
  {
    // Shumei (数美)
    id: "shumei-slider",
    kind: "slider",
    root: ".shumei_captcha_wrapper.mode-slide",
    instruction: [".shumei_captcha_slide_tips"],
    solved: ".shumei_captcha_slide_wrapper.slide_success",
    errors: [".shumei_captcha_slide_wrapper.slide_fail .shumei_captcha_slide_tips"],
    waiting: ".shumei_captcha_img_loadding_wrapper.shumei_show, .shumei_captcha_slide_wrapper.slide_fail",
    retryMs: 3000,
    targets: [
      { id: "background", selector: ".shumei_captcha_img_loaded_wrapper.shumei_show img.shumei_captcha_loaded_img_bg", optional: true },
      { id: "piece", selector: ".shumei_captcha_img_loaded_wrapper.shumei_show img.shumei_captcha_loaded_img_fg", optional: true },
      { id: "handle", selector: ".shumei_captcha_slide_btn" },
      { id: "reload", selector: ".shumei_captcha_img_refresh_btn", optional: true },
    ],
  },
  {
    // Dingxiang (顶象): canvas background with decoy holes; a failed slide may keep the puzzle.
    id: "dingxiang-slider",
    kind: "slider",
    root: ".dx_captcha_basic_wrapper:has(.dx_captcha_basic_bg canvas)",
    instruction: [".dx_captcha_basic_bar-inform"],
    errors: [".dx_captcha_basic_fail"],
    solved: ".dx_captcha_basic_success, .dx_captcha_oneclick_bar.dx-success",
    waiting: ".dx_captcha_basic_fail, .dx_captcha_basic_success",
    retryMs: 3000,
    targets: [
      { id: "background", selector: ".dx_captcha_basic_bg canvas" },
      { id: "piece", selector: ".dx_captcha_basic_sub-slider img" },
      { id: "handle", selector: ".dx_captcha_basic_slider" },
      { id: "reload", selector: "[id^=dx_captcha_basic_btn-refresh]", optional: true },
    ],
  },
  {
    // Dingxiang's "立即点击验证" (click to verify) bar that opens the puzzle.
    id: "dingxiang-button",
    kind: "checkbox",
    root: ".dx_captcha_oneclick_bar",
    solved: ".dx_captcha_oneclick_bar.dx-success",
    waiting: ".dx_captcha_basic-style-popup:not([style*='display: none'])",
    targets: [{ id: "checkbox", selector: ".dx_captcha_oneclick_bar:not(.dx-success)", optional: true }],
  },
];
