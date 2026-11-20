import type { AdapterSpec } from "../types";

/** Frames of the providers above: the catch-all text captcha never looks inside them. */
const PROVIDER_FRAMES = [
  String.raw`google\.com/recaptcha`,
  String.raw`recaptcha\.net/recaptcha`,
  String.raw`hcaptcha\.com/captcha`,
  String.raw`challenges\.cloudflare\.com`,
  String.raw`/cap_union_new_show`,
  String.raw`captcha-delivery\.com/captcha`,
  String.raw`arkoselabs\.com`,
  String.raw`mtcaptcha\.com`,
  String.raw`captcha-api\.yandex\.ru`,
  String.raw`frcapi\.com`,
].join("|");

/** Site-specific and generic widgets, and the catch-all text captcha (last). */
export const GENERIC: AdapterSpec[] = [
  {
    // GNAME's GnSliderVerify: slide to the end, scored by the track (`/request/slideverify`).
    id: "gname-slider",
    kind: "slider",
    root: ".gn-slide-rail",
    targets: [
      { id: "handle", selector: ".gn-slide-bar" },
      { id: "rail", selector: ".gn-slide-rail" },
    ],
  },
  {
    // The common open-source "drag verify" slider (#dragContainer / #dragHandler / #dragText),
    // e.g. Eranet's "Security Verification" before it mails a code.
    id: "generic-drag-verify",
    kind: "slider",
    root: "#dragContainer:has(#dragHandler)",
    instruction: ["#dragText"],
    targets: [
      { id: "handle", selector: "#dragContainer #dragHandler" },
      { id: "rail", selector: "#dragContainer:has(#dragHandler)" },
    ],
  },
  {
    // "Slide to verify" gates of phishing kits and small sites: a thumb in a rounded rail.
    id: "generic-kit-slider",
    kind: "slider",
    root: "#sliderContainer, .slider-container:has(.slider-thumb)",
    solvedText: "^verified$",
    targets: [
      { id: "handle", selector: "#sliderThumb, .slider-container .slider-thumb" },
      { id: "rail", selector: "#sliderContainer, .slider-container:has(.slider-thumb)" },
    ],
  },
  {
    id: "generic-text-image",
    kind: "text",
    url: `^(?!.*(${PROVIDER_FRAMES}))`,
    root: ["img", "canvas"].flatMap((tag) => ["src", "alt", "id", "class", "name"].map((attr) => `${tag}[${attr}*="captcha" i]`)).join(", "),
    targets: [
      {
        id: "input",
        selector: ["name", "id", "placeholder", "aria-label", "class"].map((attr) => `input[${attr}*="captcha" i]:not([type=hidden])`).join(", "),
      },
    ],
  },
];
