import { isVisible, shadowOf } from "./dom";

const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "META", "LINK", "path", "g", "defs", "use"]);

function describe(el: Element): string {
  const r = el.getBoundingClientRect();
  const id = el.id ? `#${el.id}` : "";
  const cls = typeof el.className === "string" && el.className.trim() ? `.${el.className.trim().split(/\s+/).join(".")}` : "";
  const attrs = ["role", "aria-checked", "aria-pressed", "type", "name"]
    .map((a) => (el.getAttribute(a) !== null ? `[${a}=${el.getAttribute(a)}]` : ""))
    .join("");
  const src = el instanceof HTMLImageElement ? ` src=${el.src.slice(0, 90)}` : "";
  const bg = getComputedStyle(el).backgroundImage;
  const background = bg && bg !== "none" ? ` bg=${bg.slice(0, 90)}` : "";
  const text = el.childElementCount === 0 ? (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60) : "";
  return `${el.tagName.toLowerCase()}${id}${cls}${attrs} ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}${src}${background}${text ? ` "${text}"` : ""}`;
}

/**
 * The visible element tree of this frame, one indented line per element: tag, id, classes, the
 * attributes adapters key on, box, image source and visible text. Closed shadow roots are walked
 * too (`#shadow`). What `bun run explore` prints for writing adapters.
 */
export function skeleton(): string {
  const lines: string[] = [];
  const walk = (parent: ParentNode, depth: number) => {
    for (const el of parent.children) {
      if (SKIP.has(el.tagName)) continue;
      const visible = isVisible(el);
      if (visible) lines.push(`${"  ".repeat(depth)}${describe(el)}`);
      const shadow = shadowOf(el);
      if (shadow) {
        lines.push(`${"  ".repeat(depth + 1)}#shadow`);
        walk(shadow, depth + 2);
      }
      // Invisible wrappers can still hold visible children (absolutely positioned content).
      walk(el, visible ? depth + 1 : depth);
    }
  };
  walk(document, 0);
  return lines.join("\n");
}
