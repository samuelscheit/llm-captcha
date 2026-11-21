import { nestOffset, ownerState, TOP_FRAME, uncover, type FrameOffset } from "../page/cover";
import { queryAll } from "../page/dom";

const REQUEST = "__captchaOffsetRequest";
const RESPONSE = "__captchaOffsetResponse";
const UNCOVER = "__captchaUncoverRequest";
const TIMEOUT_MS = 1000;

/**
 * Where this frame's viewport sits in the top-level viewport, whether it and its ancestors are
 * shown and uncovered, and the `responses` fields next to its frame element. Resolved by asking the
 * parent frame's content script, which finds the iframe element whose window sent the request
 * (cross-origin windows compare by identity) and adds its own offset. Frame owners inside closed
 * shadow roots (Turnstile) are found through the extension DOM API.
 */
export function frameOffset(responses: string[] = []): Promise<FrameOffset> {
  if (window === window.top) return Promise.resolve(TOP_FRAME);
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
    const timer = setTimeout(() => done({ ...TOP_FRAME, visible: false }), TIMEOUT_MS);
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ [REQUEST]: nonce, responses }, "*");
  });
}

/** Hide what covers this frame's element in every frame above it. */
export function uncoverAncestors(): void {
  if (window !== window.top) window.parent.postMessage({ [UNCOVER]: true }, "*");
}

const ownerOf = (source: MessageEventSource) =>
  queryAll(document, "iframe, frame", true).find((el) => (el as HTMLIFrameElement).contentWindow === source) as HTMLIFrameElement | undefined;

/** Answers offset and uncover requests from child frames. Installed once per frame. */
export function serveFrames(): void {
  window.addEventListener("message", async (event) => {
    if (!event.source || !(event.data?.[UNCOVER] || typeof event.data?.[REQUEST] === "string")) return;
    const owner = ownerOf(event.source);
    if (!owner) return;
    if (event.data[UNCOVER]) {
      uncover(owner);
      uncoverAncestors();
      return;
    }
    const responses = Array.isArray(event.data.responses) ? (event.data.responses as string[]) : [];
    const offset = nestOffset(await frameOffset(), ownerState(owner, responses));
    (event.source as Window).postMessage({ [RESPONSE]: event.data[REQUEST], offset }, "*");
  });
}
