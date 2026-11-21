import type { AdapterSpec } from "../types";

/** Cloudflare: the Turnstile widget (also inside "Just a moment…" pages), the page itself, the block page. */
export const CLOUDFLARE: AdapterSpec[] = [
  {
    id: "turnstile",
    kind: "checkbox",
    url: String.raw`challenges\.cloudflare\.com`,
    pierce: true,
    root: ".main-wrapper",
    retryMs: 8000,
    // Without the checkbox the widget is verifying, or retrying a failure by itself: waiting.
    solvedText: "^Success!?$",
    response: "input[name=cf-turnstile-response]",
    targets: [{ id: "checkbox", selector: "label:has(input[type=checkbox])", optional: true }],
  },
  {
    // "Just a moment…": the page checks the browser by itself (with a Turnstile when it wants a
    // click, handled above); the agent waits until it moves on to the site.
    id: "cloudflare-interstitial",
    kind: "checkbox",
    root: "#challenge-stage, #challenge-running",
    blockedText: "^(sorry, you have been blocked|you have been blocked)",
    targets: [],
  },
  {
    // A firewall rule refused the request: nothing to solve.
    id: "cloudflare-blocked",
    kind: "checkbox",
    root: "#cf-error-details, .cf-error-details",
    blockedText: "^(sorry, you have been blocked|access denied|error 1020)",
    targets: [],
  },
];
