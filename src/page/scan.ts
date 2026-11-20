import type { AdapterSpec, ChallengeStatus, ChallengeView, Target } from "../core/types";
import { isVisible, queryAll, rectOf, textOf } from "./dom";

/** Visible elements that carry text themselves (no element children with text). */
function visibleLeafTexts(root: ParentNode, pierce: boolean): string[] {
  return queryAll(root, "*", pierce)
    .filter((el) => el.childElementCount === 0 || [...el.children].every((c) => !textOf(c)))
    .filter(isVisible)
    .map(textOf)
    .filter(Boolean);
}

function visibleText(doc: ParentNode, selectors: string[] | undefined, pierce: boolean): string[] {
  const texts = (selectors ?? []).flatMap((s) => queryAll(doc, s, pierce).filter(isVisible).map(textOf));
  return [...new Set(texts.filter(Boolean))];
}

function matches(doc: ParentNode, selector: string | undefined, pierce: boolean): boolean {
  return !!selector && queryAll(doc, selector, pierce).some(isVisible);
}

function textMatches(leaves: () => string[], pattern: string | undefined): boolean {
  if (!pattern) return false;
  const re = new RegExp(pattern, "i");
  return leaves().some((t) => re.test(t));
}

function targetsOf(spec: AdapterSpec, doc: ParentNode, pierce: boolean): Target[] | null {
  const targets: Target[] = [];
  for (const t of spec.targets) {
    const found = queryAll(doc, t.selector, pierce).filter(isVisible);
    if (!found.length && !t.optional) return null;
    for (const [i, el] of (t.all ? found : found.slice(0, 1)).entries()) {
      const target: Target = { id: t.all ? `${t.id}${i + 1}` : t.id, rect: rectOf(el) };
      if (t.labelFromText) target.label = textOf(el);
      // Widgets keep hidden selection markers in every tile; only a shown one counts.
      if (t.selected) target.selected = el.matches(t.selected) || queryAll(el, t.selected, pierce).some(isVisible);
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) target.value = el.value;
      targets.push(target);
    }
  }
  return targets;
}

/**
 * Whether the challenge is still changing on its own: a visible image still loading, or a finite
 * CSS animation or transition running (tiles fading in after a click). Infinite ones (spinners,
 * decoration) never end and do not count; neither do broken images (complete, zero width).
 */
export function isBusy(root: Element, pierce: boolean): boolean {
  const images = [root, ...queryAll(root, "img", pierce)].filter((el): el is HTMLImageElement => el instanceof HTMLImageElement && isVisible(el));
  if (images.some((img) => !img.complete)) return true;
  return root.getAnimations({ subtree: true }).some((a) => a.playState === "running" && a.effect?.getTiming().iterations !== Infinity);
}

function statusOf(spec: AdapterSpec, doc: ParentNode, root: Element, targets: Target[], pierce: boolean): ChallengeStatus {
  let leaves: string[] | undefined;
  const leafTexts = () => (leaves ??= visibleLeafTexts(doc, pierce));
  if (matches(doc, spec.blocked, pierce) || textMatches(leafTexts, spec.blockedText)) return "blocked";
  if (matches(doc, spec.solved, pierce) || textMatches(leafTexts, spec.solvedText)) return "solved";
  if (spec.kind === "text" && targets.find((t) => t.id === "input")?.value) return "solved";
  if (matches(doc, spec.waiting, pierce) || isBusy(root, pierce)) return "waiting";
  if (spec.kind === "checkbox" && !targets.some((t) => t.id === "checkbox")) return "waiting";
  return "pending";
}

/** Evaluate one adapter against this frame's document. Rects are relative to this frame's viewport. */
export function scanAdapter(spec: AdapterSpec, doc: Document = document, url = location.href): ChallengeView | null {
  if (spec.url && !new RegExp(spec.url, "i").test(url)) return null;
  const pierce = !!spec.pierce;
  const root = queryAll(doc, spec.root, pierce).find(isVisible);
  if (!root) return null;
  const targets = targetsOf(spec, doc, pierce);
  if (!targets) return null;
  const region = rectOf(root);
  return {
    adapter: spec.id,
    kind: spec.kind,
    status: statusOf(spec, doc, root, targets, pierce),
    region,
    instruction: visibleText(doc, spec.instruction, pierce).join(" "),
    errors: visibleText(doc, spec.errors, pierce),
    targets,
    visible: true,
  };
}

/** All challenges in this frame; the first adapter that matches a root wins per root element. */
export function scanFrame(adapters: AdapterSpec[], doc: Document = document, url = location.href): ChallengeView[] {
  const views: ChallengeView[] = [];
  for (const spec of adapters) {
    const view = scanAdapter(spec, doc, url);
    if (view && !views.some((v) => sameRect(v.region, view.region))) views.push(view);
  }
  return views;
}

function sameRect(a: { x: number; y: number; width: number; height: number }, b: typeof a): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
