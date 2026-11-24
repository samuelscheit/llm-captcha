import type { AssistRequest } from "../page/assist";
import type { PuzzleMeasure } from "../page/puzzle";
import type { GridShift } from "./shift";
import type { MouseStep } from "./mouse";
import type { AdapterSpec, ChallengeView, PageState, Rect } from "./types";

/** A label drawn on an image, in image pixels. */
export interface ImageLabel {
  text: string;
  rect: Rect;
  /** target (default): a clickable target; motion: a region that moved across frames. */
  kind?: "target" | "motion";
}

export interface Motion {
  /** Regions that changed across the frames, in image pixels, largest first. */
  boxes: Rect[];
  /** Share of the image that changed: near 1 means a transition, not an animation. */
  changed: number;
}

/** Canvas image work, run in the browser (page code). Images are PNG base64. */
export interface ImageTools {
  /** Cut `rect` (source pixels) out of a screenshot and scale it to width × height. */
  crop(request: { image: string; rect: Rect; width: number; height: number }): Promise<string>;
  label(request: { image: string; labels: ImageLabel[] }): Promise<string>;
  /** What moved across a burst of same-size frames. */
  motion(request: { frames: string[] }): Promise<Motion>;
  /** One image of `width` × `height` with each part drawn into its rect (contact sheets). */
  compose(request: { width: number; height: number; parts: ({ image: string } & Rect)[] }): Promise<string>;
}

/**
 * Trusted input and pixels of one tab, in top-level CSS pixels. Implemented once over CDP
 * (`CdpInput`), which chrome.debugger, Playwright and Puppeteer sessions all speak.
 */
export interface Input {
  /** The visible part of the page: the layout viewport at (0, 0). */
  viewport(): Promise<Rect>;
  /** The whole viewport; `scale` is image pixels per CSS pixel. */
  screenshot(): Promise<{ image: string; scale: number }>;
  mouse(steps: MouseStep[]): Promise<void>;
  /** Type into the focused element, key by key. */
  type(text: string): Promise<void>;
}

/**
 * Everything the engine needs from a browser. The extension implements it with content scripts and
 * chrome.debugger; `CdpDriver` with plain CDP sessions from Playwright, Puppeteer or a raw socket.
 */
export interface Driver {
  readonly input: Input;
  /** Challenges in every frame, in top-level viewport coordinates, with `frame` set. */
  scan(adapters: AdapterSpec[]): Promise<ChallengeView[]>;
  /** Scroll the challenge's root into view. */
  reveal(view: ChallengeView, adapter: AdapterSpec): Promise<void>;
  /**
   * Hide what covers a challenge (`view.covered`) in the top page and in every page between it
   * and the challenge's frame, so clicks reach the widget.
   */
  uncover(view: ChallengeView, adapter: AdapterSpec): Promise<void>;
  readonly images: ImageTools;
  /**
   * Slide puzzle of a `slider` view: how far (CSS px) the piece must go, and how sure; null while
   * its images load. `withImages` also returns the images as measured (slider fixtures).
   */
  puzzle(view: ChallengeView, adapter: AdapterSpec, withImages?: boolean): Promise<PuzzleMeasure | null>;
  /** Shifted grid (`shiftedGrid`): how far its challenge image is rolled from the reference; null while they load. */
  gridShift(view: ChallengeView, adapter: AdapterSpec): Promise<GridShift | null>;
  /** Stamp counts (`stamps`) per image, in order; null while they load or when they cannot be counted. */
  countStamps(view: ChallengeView, adapter: AdapterSpec): Promise<number[] | null>;
  /** HTML of the frame a view came from, closed shadow roots included (failure reports). */
  snapshot(view: ChallengeView): Promise<string>;
  /**
   * Assist mode: put the challenge to whoever drives the browser on the top page and resolve with
   * their answer. Used when no model is configured; drivers without it fail such challenges.
   */
  ask?(request: AssistRequest): Promise<string>;
  /** Publish the state for the driving agent on the top document. */
  publish(state: PageState, detail: string): Promise<void>;
  /** URL of the top-level page, for logs. */
  url(): Promise<string>;
  /** Identity of the top-level document: changes when the page navigates, even to the same URL. */
  document(): Promise<string>;
}
