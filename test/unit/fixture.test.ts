import { describe, expect, it } from "vitest";
import { acceptedExpected } from "../../src/core/fixture";
import type { Action, ChallengeView, RoundRecord } from "../../src/core/types";

const act = (kind: Action["kind"], extra: Partial<Action> = {}): Action => ({ kind, target: null, text: null, x: null, y: null, toX: null, toY: null, ...extra });
const round = (kind: ChallengeView["kind"], region: ChallengeView["region"], actions: Action[]): RoundRecord => ({
  time: 0, url: "https://x.test/", adapter: "a", kind, round: 1, reasoning: "", actions, ms: 0, history: [], frames: [], labeled: "",
  view: { adapter: "a", kind, status: "pending", region, instruction: "", errors: [], targets: [], visible: true },
});

describe("labels from accepted rounds", () => {
  it("takes the clicked targets of a grid", () => {
    expect(acceptedExpected(round("select", { x: 0, y: 0, width: 400, height: 580 }, [act("click", { target: "t2" }), act("click", { target: "verify" })]))).toEqual({ clicks: ["t2", "verify"] });
  });

  it("takes the typed text of a text challenge, case-insensitive", () => {
    expect(acceptedExpected(round("text", { x: 0, y: 0, width: 300, height: 120 }, [act("type", { target: "input", text: "undefined emanate" }), act("click", { target: "submit" })]))).toEqual({
      clicks: ["submit"],
      text: "undefined emanate",
      caseSensitive: false,
    });
  });

  it("turns clicked points into circles in CSS px, undoing the 2x of small regions", () => {
    expect(acceptedExpected(round("point", { x: 0, y: 0, width: 200, height: 150 }, [act("clickPoint", { x: 120, y: 80 }), act("click", { target: "submit" })]))).toEqual({
      clicks: ["submit"],
      points: [{ x: 60, y: 40, r: 25 }],
    });
  });

  it("has nothing to say about a round that only waited or asked for another puzzle", () => {
    expect(acceptedExpected(round("select", { x: 0, y: 0, width: 400, height: 400 }, [act("wait")]))).toBeNull();
    expect(acceptedExpected(round("point", { x: 0, y: 0, width: 400, height: 400 }, [act("click", { target: "refresh" })]))).toBeNull();
  });
});
