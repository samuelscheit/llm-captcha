import type { AdapterSpec } from "../types";

const REFERENCE = 'img[src^="/dogcaptcha/reference.png"]';
const CHALLENGE = 'img[usemap="#challenge"]';
/** The task sentence, right after the hidden "I'm a scraper" honeypot link. */
const INSTRUCTION = "main > .lnk + p";
const REFRESH = { id: "refresh", selector: '#refresh a[href*="dogcaptcha-action=manual"]', optional: true };

/**
 * DogWAF (git.miningtcup.me/MiningTcup/dogwaf) and its forks (codeberg.org/mv12star/dogwaf-fork):
 * a JavaScript-free reverse proxy. Browsers it trusts pass an automatic CSS check; the others get
 * "click the square with the dog's nose" on a 10 × 10 image map, where each square is a link that
 * submits the answer by navigating. Paths are rooted at /dogcaptcha/ in every version.
 */
export const DOGWAF: AdapterSpec[] = [
  {
    // DogWAF: a clean reference image, and the challenge image rolled by whole squares and noised.
    id: "dogwaf-shifted",
    kind: "point",
    animated: false,
    root: `#challenge ${REFERENCE}`,
    instruction: [INSTRUCTION],
    errors: ["#feedback"],
    shiftedGrid: 10,
    targets: [{ id: "challenge", selector: `#challenge ${CHALLENGE}` }, REFRESH],
  },
  {
    // dogwaf-fork: the challenge image alone, not rolled.
    id: "dogwaf-grid",
    kind: "point",
    animated: false,
    root: `html:not(:has(${REFERENCE})) #challenge ${CHALLENGE}`,
    instruction: [INSTRUCTION],
    errors: ["#feedback"],
    targets: [REFRESH],
  },
  {
    // "compat", for old browsers (and suspicious addresses where enabled): count the dogs in each
    // noisy image. The fork pastes whole 20 × 20 copies, counted by image analysis; DogWAF drops
    // half of each copy's pixels, beyond that analysis: the model counts those.
    id: "dogwaf-compat",
    kind: "text",
    root: 'form:has(img[src^="/dogcaptcha/compat.png"])',
    instruction: ["main > h1 + p"],
    errors: ["#feedback"],
    stamps: { size: 20, wobble: 4 },
    targets: [
      { id: "image", selector: 'form img[src^="/dogcaptcha/compat.png"]', all: true },
      { id: "input", selector: 'form input[name^="dogcaptcha-compat-"]', all: true },
      { id: "submit", selector: "form input[type=submit]" },
    ],
  },
  {
    // The automatic check: CSS media queries and CSP reports, then a meta refresh into the site or the captcha.
    id: "dogwaf-auto",
    kind: "checkbox",
    root: 'html:has(link[href^="/dogcaptcha/auto/media.css"]):not(:has(#challenge)) main',
    targets: [],
  },
  {
    // Block pages (blocklisted address, rate limit, the LLM honeypot); "DogWAF is starting" waits.
    id: "dogwaf-blocked",
    kind: "checkbox",
    root: 'html:has(link[href="/dogcaptcha/style.css"]):not(:has(link[href^="/dogcaptcha/auto/"], form)) main',
    blockedText: "^You('ve been| have been) (blocked|ratelimited)$|^You stuck your snout in the honeypot$",
    targets: [],
  },
];
