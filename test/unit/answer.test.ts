import { describe, expect, it } from "vitest";
import { answerHelp, parseAnswer } from "../../src/core/answer";
import type { ChallengeView } from "../../src/core/types";

const view = (kind: ChallengeView["kind"], ids: string[]): ChallengeView => ({
  adapter: "x",
  kind,
  status: "pending",
  region: { x: 0, y: 0, width: 400, height: 300 },
  instruction: "",
  errors: [],
  targets: ids.map((id) => ({ id, rect: { x: 0, y: 0, width: 10, height: 10 } })),
  visible: true,
});
const grid = view("select", ["t1", "t2", "t3", "verify"]);
const brief = (answer: string, v = grid) =>
  parseAnswer(answer, v).actions.map((a) => {
    if (a.kind === "type") return [a.kind, a.text];
    if (a.kind === "click") return [a.kind, a.target];
    if (a.kind === "wait") return [a.kind, null];
    return [a.kind, `${a.x},${a.y}${a.toX !== null ? `>${a.toX},${a.toY}` : ""}`];
  });

describe("assist answers", () => {
  it("clicks target ids in order, whatever the separators", () => {
    expect(brief(" t2  t3;verify\n")).toEqual([["click", "t2"], ["click", "t3"], ["click", "verify"]]);
  });

  it("clicks points and drags in image pixels", () => {
    const canvas = view("point", ["submit"]);
    expect(brief("120,80 drag 10,20 200.5,20 submit", canvas)).toEqual([["clickPoint", "120,80"], ["drag", "10,20>200.5,20"], ["click", "submit"]]);
  });

  it("types after `type`, keeping case and inner spaces", () => {
    expect(brief("type Ab 12", view("text", ["input"]))).toEqual([["type", "Ab 12"]]);
  });

  it("takes the bare characters as the answer of a text challenge", () => {
    expect(brief("xK4p9", view("text", ["input"]))).toEqual([["type", "xK4p9"]]);
  });

  it("waits", () => {
    expect(brief("wait")).toEqual([["wait", null]]);
  });

  it.each([
    ["", "Empty answer."],
    ["t9", 'Unknown target "t9". Targets: t1, t2, t3, verify.'],
    ["drag 1,2", "drag needs two points"],
    ["type abc", "no input to type into"],
  ])("refuses %j with a message the answerer can act on", (answer, message) => {
    expect(() => parseAnswer(answer, grid)).toThrow(message);
  });

  it("explains the syntax for the challenge at hand", () => {
    expect(answerHelp(grid, { width: 400, height: 300, scale: 1 })).toContain('"t2 t5 verify"');
    expect(answerHelp(view("point", ["submit"]), { width: 446, height: 349, scale: 1 })).toContain("points of the image (446x349)");
  });
});
