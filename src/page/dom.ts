import type { Rect } from "../core/types";

/** Closed shadow roots handed in by a CDP driver, which can see them through DOM.getDocument. */
export const seededShadows = new WeakMap<Element, ShadowRoot>();

/** Shadow root of an element: closed ones through the extension API or the CDP-seeded map. */
export function shadowOf(el: Element): ShadowRoot | null {
  // The extension API throws for anything but HTML elements (SVG, MathML), which cannot host one.
  const closed = el instanceof HTMLElement ? (globalThis.chrome?.dom?.openOrClosedShadowRoot?.(el) as ShadowRoot | null | undefined) : undefined;
  return closed ?? seededShadows.get(el) ?? el.shadowRoot ?? null;
}

/** querySelectorAll that optionally descends into every shadow root. */
export function queryAll(root: ParentNode, selector: string, pierce = false): Element[] {
  const found = [...root.querySelectorAll(selector)];
  if (!pierce) return found;
  for (const el of root.querySelectorAll("*")) {
    const shadow = shadowOf(el);
    if (shadow) found.push(...queryAll(shadow, selector, true));
  }
  return found;
}

export function isVisible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  return el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
}

export function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

export function textOf(el: Element): string {
  return ((el as HTMLElement).innerText ?? el.textContent ?? "").replace(/\s+/g, " ").trim();
}


