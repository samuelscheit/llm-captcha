import type { AdapterSpec } from "../types";

/**
 * GeeTest, all in the top document. v4 (gcaptcha4.js) classes come twice, hashed per load and
 * plain: only the plain ones are used. v3 (gt.js) themes vary; the structure does not.
 */
const V4 = {
  instruction: [".geetest_box .geetest_text_tips"],
  errors: [".geetest_box .geetest_result_tips.geetest_fail"],
  solved: ".geetest_captcha.geetest_lock_success",
  waiting: ".geetest_captcha.geetest_compute, .geetest_captcha.geetest_fail, .geetest_captcha.geetest_refresh",
};
const V4_REFRESH = { id: "refresh", selector: ".geetest_box .geetest_refresh", optional: true };

export const GEETEST: AdapterSpec[] = [
  {
    id: "geetest-v4-slide",
    kind: "slider",
    root: ".geetest_box .geetest_subitem.geetest_slide",
    ...V4,
    targets: [
      // CSS background images; the piece starts at the background's left edge, moves 1:1.
      { id: "background", selector: ".geetest_slide .geetest_bg" },
      { id: "piece", selector: ".geetest_slide .geetest_slice_bg" },
      { id: "handle", selector: ".geetest_slide .geetest_btn" },
      { id: "reload", selector: ".geetest_box .geetest_refresh", optional: true },
    ],
  },
  {
    // icon / word / phrase: click the items in the order the header shows, then OK.
    id: "geetest-v4-click",
    kind: "point",
    animated: false,
    root: ".geetest_box:has(.geetest_subitem.geetest_click)",
    ...V4,
    targets: [{ id: "submit", selector: ".geetest_box .geetest_submit", labelFromText: true }, V4_REFRESH],
  },
  {
    // "Select 3 images with [icon]": submits by itself after the third pick.
    id: "geetest-v4-nine",
    kind: "select",
    root: ".geetest_box:has(.geetest_subitem.geetest_nine)",
    ...V4,
    targets: [{ id: "t", selector: ".geetest_nine .geetest_item", all: true, selected: ".geetest_item_ghost.geetest_selected" }, V4_REFRESH],
  },
  {
    // IconCrush: swap two neighbours (two clicks) to line up three; submits on the second click.
    id: "geetest-v4-match",
    kind: "select",
    root: ".geetest_box:has(.geetest_subitem.geetest_match)",
    ...V4,
    targets: [{ id: "t", selector: ".geetest_match .geetest_backimg", all: true, selected: ".geetest_active" }, V4_REFRESH],
  },
  {
    // Gobang: move one ball (click it, then an empty cell) to line up five; submits on the move.
    id: "geetest-v4-gobang",
    kind: "select",
    root: ".geetest_box:has(.geetest_subitem.geetest_winlinze)",
    ...V4,
    targets: [{ id: "t", selector: ".geetest_winlinze .geetest_itemimg", all: true, selected: ".geetest_active" }, V4_REFRESH],
  },
  {
    // "Click to verify": opens the dialog; waiting while it is open or verifying.
    id: "geetest-v4-button",
    kind: "checkbox",
    root: ".geetest_captcha .geetest_holder:has(.geetest_btn_click)",
    solved: ".geetest_captcha.geetest_lock_success",
    waiting: ".geetest_captcha.geetest_boxShow, .geetest_captcha.geetest_compute, .geetest_captcha.geetest_wait",
    targets: [{ id: "checkbox", selector: ".geetest_captcha .geetest_btn_click" }],
  },
  {
    // v3 slide: two canvases the size of the image; the piece canvas is transparent around it.
    id: "geetest-v3-slide",
    kind: "slider",
    root: ".geetest_holder:has(canvas.geetest_canvas_slice) .geetest_widget",
    instruction: [".geetest_slider_tip"],
    errors: [".geetest_result.geetest_fail .geetest_result_content, .geetest_result.geetest_forbidden .geetest_result_content, .geetest_result.geetest_error .geetest_result_content"],
    solved: ".geetest_radar_success, .geetest_slider.geetest_success",
    waiting: ".geetest_slider.geetest_lock, .geetest_slider.geetest_forbidden, .geetest_slider.geetest_fail",
    targets: [
      { id: "background", selector: "canvas.geetest_canvas_bg" },
      { id: "piece", selector: "canvas.geetest_canvas_slice" },
      { id: "handle", selector: ".geetest_slider_button" },
      { id: "reload", selector: ".geetest_refresh_1", optional: true },
    ],
  },
  {
    // v3 click ("请在下图依次点击", click in order), then confirm.
    id: "geetest-v3-click",
    kind: "point",
    animated: false,
    root: ".geetest_holder:has(.geetest_item_wrap) .geetest_widget",
    instruction: [".geetest_tip_content"],
    errors: [".geetest_result_tip.geetest_fail"],
    solved: ".geetest_radar_success",
    targets: [
      { id: "submit", selector: ".geetest_commit", labelFromText: true },
      { id: "refresh", selector: ".geetest_widget .geetest_refresh", optional: true },
    ],
  },
  {
    // v3 "点击按钮进行验证" (click the button to verify): opens the popup.
    id: "geetest-v3-radar",
    kind: "checkbox",
    root: ".geetest_holder:has(> .geetest_btn .geetest_radar_btn)",
    solved: ".geetest_radar_success",
    waiting: ".geetest_holder.geetest_radar_click_ready, .geetest_holder.geetest_detect, .geetest_holder.geetest_wait_compute",
    targets: [{ id: "checkbox", selector: ".geetest_radar_tip" }],
  },
];
