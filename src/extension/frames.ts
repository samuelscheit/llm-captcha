import { isVisible, queryAll } from "../page/dom";

/** Where this frame's viewport sits in the top-level viewport, and whether it and its ancestors are shown. */
export interface FrameOffset {
  x: number;
  y: number;
  visible: boolean;
}

const REQUEST = "__captchaOffsetRequest";
const RESPONSE = "__captchaOffsetResponse";
const TIMEOUT_MS = 1000;

const TOP: FrameOffset = { x: 0, y: 0, visible: true };

/**
 * Offsets are resolved by asking the parent frame's content script, which finds the iframe element
 * whose window sent the request (cross-origin windows compare by identity) and adds its own offset.
 * Frame owners inside closed shadow roots (Turnstile) are found through the extension DOM API.
 */
export function frameOffset(): Promise<FrameOffset> {
  if (window === window.top) return Promise.resolve(TOP);
  const nonce = crypto.randomUUID();
  return new Promise((resolve) => {
    const done = (offset: FrameOffset) => {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(offset);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source === window.parent && event.data?.[RESPONSE] === nonce) done(event.data.offset);
    };
    // A parent without our content script (denied, about:blank quirks) never answers.
    const timer = setTimeout(() => done({ x: 0, y: 0, visible: false }), TIMEOUT_MS);
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ [REQUEST]: nonce }, "*");
  });
}

/** Answers offset requests from child frames. Installed once per frame. */
export function serveFrameOffsets(): void {
  window.addEventListener("message", async (event) => {
    const nonce = event.data?.[REQUEST];
    if (typeof nonce !== "string" || !event.source) return;
    const owner = queryAll(document, "iframe, frame", true).find(
      (el) => (el as HTMLIFrameElement).contentWindow === event.source,
    ) as HTMLIFrameElement | undefined;
    if (!owner) return;
    const own = await frameOffset();
    const rect = owner.getBoundingClientRect();
    const style = getComputedStyle(owner);
    const x = rect.x + owner.clientLeft + parseFloat(style.paddingLeft);
    const y = rect.y + owner.clientTop + parseFloat(style.paddingTop);
    const offset: FrameOffset = {
      x: own.x + x,
      y: own.y + y,
      // Vendors park hidden challenge frames far outside the document (top: -10000px).
      visible: own.visible && isVisible(owner) && rect.right + scrollX > 0 && rect.bottom + scrollY > 0,
    };
    (event.source as Window).postMessage({ [RESPONSE]: nonce, offset }, "*");
  });
}
