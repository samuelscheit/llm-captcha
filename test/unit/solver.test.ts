import { describe, expect, it } from "vitest";
import { imageFrame, labelsOf, pickChallenge, withSubmit } from "../../src/core/engine";
import { buildPrompt, SYSTEM_PROMPT } from "../../src/core/prompt";
import { score } from "../../src/core/score";
import { recoverDecision, sanitize } from "../../src/core/solver";
import type { Action, ChallengeView } from "../../src/core/types";

const act = (kind: Action["kind"], extra: Partial<Action> = {}): Action => ({ kind, target: null, text: null, x: null, y: null, toX: null, toY: null, ...extra });

const grid: ChallengeView = {
  adapter: "recaptcha-images",
  kind: "select",
  status: "pending",
  region: { x: 100, y: 50, width: 400, height: 580 },
  instruction: "Select all images with crosswalks",
  errors: [],
  targets: [
    { id: "t1", rect: { x: 105, y: 175, width: 130, height: 130 }, selected: false },
    { id: "t2", rect: { x: 235, y: 175, width: 130, height: 130 }, selected: true },
    { id: "verify", rect: { x: 392, y: 580, width: 100, height: 42 }, label: "Verify" },
    { id: "offscreen", rect: { x: 900, y: 900, width: 10, height: 10 } },
  ],
  visible: true,
};

describe("pickChallenge", () => {
  const checkbox: ChallengeView = { ...grid, adapter: "recaptcha-checkbox", kind: "checkbox", targets: [] };
  it("prefers an open challenge over the checkbox that opened it", () => {
    expect(pickChallenge([checkbox, grid])?.adapter).toBe("recaptcha-images");
  });
  it("ignores hidden and non-pending views", () => {
    expect(pickChallenge([{ ...grid, visible: false }, checkbox])?.adapter).toBe("recaptcha-checkbox");
    expect(pickChallenge([{ ...grid, status: "waiting" }, { ...checkbox, status: "solved" }])).toBeUndefined();
  });
});

describe("image frame and labels", () => {
  it("upscales small regions 2x and keeps large ones", () => {
    expect(imageFrame({ x: 0, y: 0, width: 180, height: 60 })).toEqual({ width: 360, height: 120, scale: 2 });
    expect(imageFrame({ x: 0, y: 0, width: 400, height: 580 })).toEqual({ width: 400, height: 580, scale: 1 });
  });
  it("labels targets inside the region in image pixels and drops the rest", () => {
    const labels = labelsOf(grid, imageFrame(grid.region));
    expect(labels.map((l) => l.text)).toEqual(["t1", "t2", "verify"]);
    expect(labels[0]!.rect).toEqual({ x: 5, y: 125, width: 130, height: 130 });
  });
  it("leaves text challenges unlabeled so the characters stay readable", () => {
    expect(labelsOf({ ...grid, kind: "text" }, imageFrame(grid.region))).toEqual([]);
  });
});

describe("prompt", () => {
  it("lists targets in image pixels with labels, selection and values", () => {
    const prompt = buildPrompt(grid, imageFrame(grid.region), []);
    expect(prompt).toContain("Instruction: Select all images with crosswalks");
    expect(prompt).toContain("- t1: x=5 y=125 w=130 h=130, not selected");
    expect(prompt).toContain("- t2: x=135 y=125 w=130 h=130, SELECTED");
    expect(prompt).toContain('- verify: x=292 y=530 w=100 h=42, label "Verify"');
    expect(prompt).not.toContain("Previous rounds");
  });
  it("never names the widget: some models refuse what is called a captcha", () => {
    const prompt = buildPrompt(grid, imageFrame(grid.region), []);
    expect(`${SYSTEM_PROMPT}\n${prompt}`).not.toMatch(/captcha|verification|recaptcha-images/i);
  });
  it("feeds earlier rounds and their errors back", () => {
    const prompt = buildPrompt({ ...grid, errors: ["Please select all matching images."] }, imageFrame(grid.region), [
      { instruction: "Select all images with crosswalks", decision: { reasoning: "t1 has stripes", actions: [act("click", { target: "t1" })] }, errorsAfter: ["Please try again."] },
    ]);
    expect(prompt).toContain("Errors shown now: Please select all matching images.");
    expect(prompt).toContain("Round 1:");
    expect(prompt).toContain("actions: click t1");
    expect(prompt).toContain("errors afterwards: Please try again.");
  });
});

describe("sanitize", () => {
  const frame = imageFrame(grid.region);
  it("drops actions on unknown targets, outside the image or without text", () => {
    const out = sanitize(
      {
        reasoning: "",
        actions: [
          act("click", { target: "t1" }),
          act("click", { target: "t99" }),
          act("click"),
          act("type", { target: "t1" }),
          act("clickPoint", { x: 10, y: 10 }),
          act("clickPoint", { x: 401, y: 10 }),
          act("clickPoint", { x: 10 }),
          act("drag", { x: 1, y: 1, toX: 399, toY: 579 }),
          act("drag", { x: 1, y: 1, toX: -1, toY: 5 }),
          act("wait"),
        ],
      },
      grid,
      frame,
    );
    expect(out.actions.map((a) => `${a.kind}:${a.target ?? a.x}`)).toEqual(["click:t1", "clickPoint:10", "drag:1", "wait:null"]);
  });
});

describe("score", () => {
  const frame = { width: 360, height: 120, scale: 2 };
  it("compares clicks as a set and reports missing and extra ones", () => {
    const d = { reasoning: "", actions: [act("click", { target: "t3" }), act("click", { target: "t1" }), act("click", { target: "verify" })] };
    expect(score(d, { clicks: ["t1", "t3", "verify"] }, frame).pass).toBe(true);
    const bad = score(d, { clicks: ["t1", "t2", "verify"] }, frame);
    expect(bad.pass).toBe(false);
    expect(bad.problems[0]).toBe("clicks: missing [t2], extra [t3]");
  });
  it("flags a target clicked twice (which unselects it)", () => {
    const d = { reasoning: "", actions: [act("click", { target: "t1" }), act("click", { target: "t1" })] };
    expect(score(d, { clicks: ["t1"] }, frame).problems).toEqual(["clicks: missing [], extra [t1]"]);
  });
  it("compares text case-insensitively unless asked", () => {
    const d = { reasoning: "", actions: [act("type", { target: "input", text: " xK4p9 " })] };
    expect(score(d, { text: "XK4P9" }, frame).pass).toBe(true);
    expect(score(d, { text: "XK4P9", caseSensitive: true }, frame).pass).toBe(false);
  });
  it("maps clickPoint image pixels back to CSS pixels and needs one hit per circle", () => {
    const hit = { reasoning: "", actions: [act("clickPoint", { x: 200, y: 100 })] }; // css 100,50
    expect(score(hit, { points: [{ x: 100, y: 50, r: 5 }] }, frame).pass).toBe(true);
    expect(score(hit, { points: [{ x: 120, y: 50, r: 5 }] }, frame).problems).toEqual([
      "point 1: 0 clicks inside, expected 1",
      "clicks outside every expected point: 100,50",
    ]);
  });
});

describe("text answers are submitted", () => {
  const text = (ids: string[]): ChallengeView => ({ ...grid, kind: "text", targets: ids.map((id) => ({ id, rect: { x: 0, y: 0, width: 10, height: 10 } })) });
  it("presses the widget's submit after typing", () => {
    expect(withSubmit(text(["input", "submit"]), [act("type", { target: "input", text: "ab" })]).map((a) => a.target)).toEqual(["input", "submit"]);
    expect(withSubmit(text(["input", "verify"]), [act("type", { target: "input", text: "ab" })]).map((a) => a.target)).toEqual(["input", "verify"]);
  });
  it("leaves answers alone that already submit, have no button, or are not typed", () => {
    expect(withSubmit(text(["input", "submit"]), [act("type", { target: "input", text: "ab" }), act("click", { target: "submit" })])).toHaveLength(2);
    expect(withSubmit(text(["input"]), [act("type", { target: "input", text: "ab" })])).toHaveLength(1);
    expect(withSubmit(grid, [act("click", { target: "t1" })])).toHaveLength(1);
  });
});

// Some gateways drop the response format: the model then answers in prose around a JSON block.
describe("recoverDecision", () => {
  const decision = { reasoning: "reads CMYS", actions: [act("type", { target: "input", text: "CMYS" })] };
  const json = JSON.stringify(decision);

  it("finds a fenced block after prose", () => {
    expect(recoverDecision(`The text reads CMYS.\n\n\`\`\`json\n${json}\n\`\`\``)).toEqual(decision);
  });

  it("finds a bare object inside prose", () => {
    expect(recoverDecision(`Answer: ${json} done.`)).toEqual(decision);
  });

  it("takes the last valid block when an earlier one is a draft", () => {
    const draft = JSON.stringify({ reasoning: "draft", actions: [] });
    expect(recoverDecision(`\`\`\`json\n${draft}\n\`\`\`\nFixed:\n\`\`\`json\n${json}\n\`\`\``)).toEqual(decision);
  });

  it("refuses objects of another shape and non-JSON", () => {
    expect(recoverDecision(`{"actions":[{"action":"type","target":"input","text":"CMYS"}]}`)).toBeNull();
    expect(recoverDecision("I cannot solve this.")).toBeNull();
    expect(recoverDecision("{not json}")).toBeNull();
  });
});
