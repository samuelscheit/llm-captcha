import type { AdapterSpec, ChallengeView, PageState } from "../core/types";
import type { ImageTools } from "../core/driver";
import { ownerState, uncover } from "./cover";
import { isVisible, queryAll, seededShadows, shadowOf } from "./dom";
import { ask, ASSIST_HOST_ID } from "./assist";
import { compose, crop, label, motion } from "./image";
import { measurePuzzle } from "./puzzle";
import { measureGridShift } from "./shift";
import { measureStamps } from "./stamps";
import { skeleton } from "./skeleton";
import { scanFrame } from "./scan";

const SNAPSHOT_LIMIT = 512 * 1024;

/**
 * The code a driver runs inside page frames, in an isolated world: the extension as a content
 * script, CDP drivers by injecting the bundled source (`dist/page.js`). Views are relative to the
 * frame's own viewport; the driver adds frame offsets.
 */
export interface PageApi {
  scan(adapters: AdapterSpec[]): ChallengeView[];
  reveal(adapter: AdapterSpec): void;
  /**
   * Hide what covers the challenge's root in this frame, when this is the top page (see `scan`).
   * Covers of frame elements are hidden in their parent frame with `uncoverElement`.
   */
  uncover(adapter: AdapterSpec): string[];
  uncoverElement(el: Element): string[];
  ownerState: typeof ownerState;
  images: ImageTools;
  publish(state: PageState, detail: string): void;
  /** This frame's document as HTML, closed shadow roots included, for fixing adapters offline. */
  snapshot(): string;
  measurePuzzle: typeof measurePuzzle;
  measureGridShift: typeof measureGridShift;
  measureStamps: typeof measureStamps;
  ask: typeof ask;
  /** Visible element tree, for writing adapters (`bun run explore`). */
  skeleton: typeof skeleton;
  /** Hand closed shadow roots in, as [host, root, host, root, ...]. */
  seedShadows(...pairs: Node[]): void;
}

export const pageApi: PageApi = {
  scan: (adapters) => scanFrame(adapters),
  reveal(adapter) {
    // Instant: sites with `scroll-behavior: smooth` would still be moving at the next screenshot.
    queryAll(document, adapter.root, !!adapter.pierce).find(isVisible)?.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  },
  uncover(adapter) {
    if (window !== window.top) return [];
    const root = queryAll(document, adapter.root, !!adapter.pierce).find(isVisible);
    return root ? uncover(root) : [];
  },
  uncoverElement: uncover,
  ownerState,
  images: { crop, label, motion, compose },
  publish(state, detail) {
    // A session that ended (timed out, solved by someone else) leaves no panel behind.
    if (state !== "solving") document.getElementById(ASSIST_HOST_ID)?.remove();
    const html = document.documentElement;
    html.dataset.captchaState = state;
    html.dataset.captchaDetail = detail;
    window.dispatchEvent(new CustomEvent("captcha-state", { detail: JSON.stringify({ state, detail }) }));
  },
  measurePuzzle,
  measureGridShift,
  measureStamps,
  ask,
  skeleton,
  snapshot() {
    const roots = queryAll(document, "*", true).flatMap((el) => shadowOf(el) ?? []);
    return document.documentElement
      .getHTML({ serializableShadowRoots: true, shadowRoots: roots })
      .replace(/<script\b[\s\S]*?<\/script>/gi, "")
      .replace(/data:([\w/+.-]+);base64,[A-Za-z0-9+/=]{2048,}/g, "data:$1;base64,…")
      .slice(0, SNAPSHOT_LIMIT);
  },
  seedShadows(...pairs) {
    for (let i = 0; i + 1 < pairs.length; i += 2) seededShadows.set(pairs[i] as Element, pairs[i + 1] as ShadowRoot);
  },
};

export const PAGE_GLOBAL = "__captcha";
