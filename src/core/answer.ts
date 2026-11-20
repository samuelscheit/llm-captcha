/**
 * Assist mode: without a model, whoever drives the browser (an AI agent or a person) answers in a
 * short syntax, which becomes the same Decision a model would return.
 *
 *   t2 t5 verify          click targets by id
 *   120,80                click a point of the image (image pixels)
 *   drag 10,20 200,20     drag between two points of the image
 *   type XK4P9            type into the input target (for text challenges the bare text works too)
 *   wait                  do nothing this round
 */
import type { ImageFrame } from "./prompt";
import type { Action, ChallengeView, Decision } from "./types";

const action = (kind: Action["kind"], fields: Partial<Action> = {}): Action => ({ kind, target: null, text: null, x: null, y: null, toX: null, toY: null, ...fields });
const POINT = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/;

export class AnswerError extends Error {}

export function parseAnswer(answer: string, view: ChallengeView): Decision {
  const text = answer.trim();
  const reasoning = `answered in assist mode: ${text}`;
  const input = view.targets.find((t) => t.id === "input");
  const typed = /^type\s+(.+)$/is.exec(text);
  if (typed) {
    if (!input) throw new AnswerError("This challenge has no input to type into.");
    return { reasoning, actions: [action("type", { target: "input", text: typed[1]!.trim() })] };
  }
  const ids = new Set(view.targets.map((t) => t.id));
  const tokens = text.split(/[\s;]+/).filter(Boolean);
  const actions: Action[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const point = POINT.exec(token);
    if (ids.has(token)) actions.push(action("click", { target: token }));
    else if (point) actions.push(action("clickPoint", { x: Number(point[1]), y: Number(point[2]) }));
    else if (token.toLowerCase() === "wait") actions.push(action("wait"));
    else if (token.toLowerCase() === "drag") {
      const from = POINT.exec(tokens[i + 1] ?? "");
      const to = POINT.exec(tokens[i + 2] ?? "");
      if (!from || !to) throw new AnswerError("drag needs two points: drag x1,y1 x2,y2");
      actions.push(action("drag", { x: Number(from[1]), y: Number(from[2]), toX: Number(to[1]), toY: Number(to[2]) }));
      i += 2;
    } else if (view.kind === "text" && input) {
      // A text challenge's answer is the characters themselves.
      return { reasoning, actions: [action("type", { target: "input", text })] };
    } else throw new AnswerError(`Unknown target "${token}". Targets: ${[...ids].join(", ")}.`);
  }
  if (!actions.length) throw new AnswerError("Empty answer.");
  return { reasoning, actions };
}

/** What the person or agent answering is told, besides the instruction and the image. */
export function answerHelp(view: ChallengeView, frame: ImageFrame): string {
  const ids = view.targets.map((t) => t.id).join(" ");
  const lines = [`Targets (labeled on the image): ${ids}.`];
  if (view.kind === "select" || view.kind === "checkbox") lines.push("Answer with the ids to click, in order, e.g. \"t2 t5 verify\".");
  if (view.kind === "point") lines.push(`Answer with points of the image (${frame.width}x${frame.height}), e.g. "120,80 submit", or "drag 10,20 200,20".`);
  if (view.kind === "text") lines.push("Answer with the characters in the image.");
  lines.push('"wait" if the image is still loading.');
  return lines.join(" ");
}
