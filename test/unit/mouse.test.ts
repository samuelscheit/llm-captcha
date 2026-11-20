import { describe, expect, it } from "vitest";
import { clickSteps, dragSteps, seeded } from "../../src/core/mouse";

describe("gesture plans", () => {
  it("click ends with press and release on the same point near the target, after a hover that ends there", () => {
    const steps = clickSteps({ x: 200, y: 100 }, seeded(1), undefined, 3);
    const [press, release] = steps.slice(-2);
    expect(press!.type).toBe("mousePressed");
    expect(release!.type).toBe("mouseReleased");
    expect({ x: press!.x, y: press!.y }).toEqual({ x: release!.x, y: release!.y });
    expect(Math.abs(press!.x - 200)).toBeLessThanOrEqual(3);
    expect(Math.abs(press!.y - 100)).toBeLessThanOrEqual(3);
    const hover = steps.slice(0, -2);
    expect(hover.every((s) => s.type === "mouseMoved" && s.buttons === 0)).toBe(true);
    expect(hover.at(-1)).toMatchObject({ x: press!.x, y: press!.y });
  });

  it("click starts from the previous pointer position when given", () => {
    const steps = clickSteps({ x: 500, y: 400 }, seeded(2), { x: 10, y: 10 });
    // First move is a small eased step away from the start, not a jump next to the target.
    expect(Math.hypot(steps[0]!.x - 10, steps[0]!.y - 10)).toBeLessThan(20);
    // Long distances take more steps than short ones.
    expect(steps.length).toBeGreaterThan(clickSteps({ x: 30, y: 20 }, seeded(2), { x: 10, y: 10 }).length);
  });

  it("is reproducible with a seeded source and varies between seeds", () => {
    expect(clickSteps({ x: 50, y: 50 }, seeded(7))).toEqual(clickSteps({ x: 50, y: 50 }, seeded(7)));
    expect(clickSteps({ x: 50, y: 50 }, seeded(7))).not.toEqual(clickSteps({ x: 50, y: 50 }, seeded(8)));
  });

  it("drag holds the button from press to release, overshoots, and releases exactly on the target", () => {
    const from = { x: 100, y: 300 };
    const to = { x: 340, y: 300 };
    const steps = dragSteps(from, to, seeded(3));
    const pressAt = steps.findIndex((s) => s.type === "mousePressed");
    expect(steps[pressAt]).toMatchObject(from);
    const held = steps.slice(pressAt + 1, -1);
    expect(held.every((s) => s.type === "mouseMoved" && s.buttons === 1)).toBe(true);
    expect(Math.max(...held.map((s) => s.x))).toBeGreaterThan(to.x + 1);
    expect(steps.at(-1)).toMatchObject({ type: "mouseReleased", ...to, buttons: 0 });
    // Human pace: the dragging part takes about half a second or more.
    expect(held.reduce((t, s) => t + s.delayMs, 0)).toBeGreaterThan(400);
  });

  it("drag works in any direction, including very short ones", () => {
    const steps = dragSteps({ x: 300, y: 300 }, { x: 298, y: 290 }, seeded(4));
    expect(steps.at(-1)).toMatchObject({ x: 298, y: 290 });
    expect(steps.every((s) => Number.isFinite(s.x) && Number.isFinite(s.y))).toBe(true);
  });
});
