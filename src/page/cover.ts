/**
 * Whether a challenge can be clicked where it shows: cookie banners, modal backdrops and sticky
 * bars of the embedding page sit on top of widgets and take the trusted clicks meant for them.
 * Also the response field a widget fills in its embedding page (its token).
 */
import type { AdapterSpec, ChallengeView, Rect } from "../core/types";
import { ASSIST_HOST_ID } from "./assist";

/** Points of an element that are hit-tested, as fractions of its box. */
const FRACTIONS = [0.2, 0.5, 0.8];
/** Covers hidden for one element at most, in case hiding one only shows the next. */
const MAX_HIDDEN = 8;

/** `node` is `ancestor` or inside it, across shadow roots. */
function within(node: Node, ancestor: Node): boolean {
  for (let n: Node | null = node; n; n = n.parentNode ?? (n instanceof ShadowRoot ? n.host : null)) if (n === ancestor) return true;
  return false;
}

/** Short CSS-like name of an element for logs and failure details: `div#onetrust-consent-sdk`. */
export function nameOf(el: Element): string {
  const id = el.id ? `#${el.id}` : "";
  const cls = !id && typeof el.className === "string" && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}` : "";
  return `${el.tagName.toLowerCase()}${id}${cls}`;
}

/**
 * The element on top at one of `el`'s points inside the viewport that is neither `el`, inside it,
 * nor one of its ancestors (those only show through where `el` lets clicks pass). Points outside
 * the viewport cannot be tested: an element scrolled out of view is not covered.
 */
export function coveredBy(el: Element): Element | null {
  const doc = el.ownerDocument;
  const r = el.getBoundingClientRect();
  const { clientWidth, clientHeight } = doc.documentElement;
  for (const fy of FRACTIONS) {
    for (const fx of FRACTIONS) {
      const x = r.x + r.width * fx;
      const y = r.y + r.height * fy;
      if (x < 0 || y < 0 || x >= clientWidth || y >= clientHeight) continue;
      const hit = doc.elementFromPoint(x, y);
      if (!hit || within(hit, el) || within(el, hit) || hit.id === ASSIST_HOST_ID) continue;
      return hit;
    }
  }
  return null;
}

/**
 * Hide what covers `el`: the outermost ancestor of the covering element that does not contain
 * `el` (the whole cookie banner with its backdrop, not one of its buttons). Returns their names.
 */
export function uncover(el: Element): string[] {
  const hidden: string[] = [];
  for (let hit = coveredBy(el); hit && hidden.length < MAX_HIDDEN; hit = coveredBy(el)) {
    let cover = hit;
    while (cover.parentElement && !within(el, cover.parentElement)) cover = cover.parentElement;
    const style = (cover as HTMLElement).style;
    style.setProperty("visibility", "hidden", "important");
    style.setProperty("pointer-events", "none", "important");
    hidden.push(nameOf(cover));
  }
  return hidden;
}

/**
 * Value of the first field matching `selector` nearest to `owner` (the widget's frame element):
 * searched in its ancestors from the closest out, across shadow roots. Undefined when there is none.
 */
function fieldNear(owner: Element, selector: string): string | undefined {
  for (let n: Node | null = owner.parentNode; n; n = n instanceof ShadowRoot ? n.host : n.parentNode) {
    if (!(n instanceof Element || n instanceof ShadowRoot || n instanceof Document)) continue;
    const field = n.querySelector(selector);
    if (field) return (field as HTMLInputElement).value ?? "";
  }
  return undefined;
}

/** Where a child frame sits in this frame's viewport, whether it shows and is covered, and the response fields next to it. */
export interface OwnerState {
  x: number;
  y: number;
  visible: boolean;
  /** Name of the element on top of the frame, when one is. */
  covered?: string;
  /** Value per response selector found next to the frame (`AdapterSpec.response`). */
  responses: Record<string, string>;
}

export function ownerState(owner: HTMLIFrameElement, responseSelectors: string[]): OwnerState {
  const r = owner.getBoundingClientRect();
  const s = getComputedStyle(owner);
  const shown = owner.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && r.width > 1 && r.height > 1;
  const view = owner.ownerDocument.defaultView!;
  const cover = shown ? coveredBy(owner) : null;
  const responses: Record<string, string> = {};
  for (const selector of responseSelectors) {
    const value = fieldNear(owner, selector);
    if (value !== undefined) responses[selector] = value;
  }
  return {
    x: r.x + owner.clientLeft + parseFloat(s.paddingLeft),
    y: r.y + owner.clientTop + parseFloat(s.paddingTop),
    // Vendors park hidden challenge frames far outside the document (top: -10000px).
    visible: shown && r.right + view.scrollX > 0 && r.bottom + view.scrollY > 0,
    covered: cover ? nameOf(cover) : undefined,
    responses,
  };
}

/** A frame's viewport in top-level coordinates, as composed from its owners up the chain. */
export type FrameOffset = OwnerState;

export const TOP_FRAME: FrameOffset = { x: 0, y: 0, visible: true, responses: {} };

/** The offset of a frame inside a parent at `base`: covered when it or any owner above is. */
export function nestOffset(base: FrameOffset, owner: OwnerState): FrameOffset {
  return { x: base.x + owner.x, y: base.y + owner.y, visible: base.visible && owner.visible, covered: base.covered ?? owner.covered, responses: owner.responses };
}

/** Response selectors of the adapters, to look up next to every frame element. */
export const responseSelectors = (adapters: AdapterSpec[]) => [...new Set(adapters.flatMap((a) => a.response ?? []))];

/** A frame's view in top-level coordinates, with the frame's covers and its adapter's response. */
export function placeView(view: ChallengeView, offset: FrameOffset, adapters: AdapterSpec[]): ChallengeView {
  const move = (r: Rect): Rect => ({ ...r, x: r.x + offset.x, y: r.y + offset.y });
  const selector = adapters.find((a) => a.id === view.adapter)?.response;
  const covered = view.covered ?? offset.covered;
  const response = selector === undefined ? undefined : offset.responses[selector];
  return {
    ...view,
    region: move(view.region),
    targets: view.targets.map((t) => ({ ...t, rect: move(t.rect) })),
    visible: view.visible && offset.visible,
    ...(covered !== undefined && { covered }),
    ...(response !== undefined && { response }),
  };
}
