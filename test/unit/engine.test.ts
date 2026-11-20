// The solve loop against a scripted fake widget: recovery behaviour without a browser.
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import type { Driver } from "../../src/core/driver";
import { solve } from "../../src/core/engine";
import { seeded, type MouseStep } from "../../src/core/mouse";
import type { AdapterSpec, ChallengeView, Decision, PageState, Rect, Target } from "../../src/core/types";

const ADAPTER: AdapterSpec = { id: "fake-grid", kind: "select", root: "#c", targets: [] };
const rect = (x: number, y: number, width = 100, height = 100): Rect => ({ x, y, width, height });
const inside = (r: Rect, p: { x: number; y: number }) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;

/** A grid widget: t1/t2 tiles, verify, reload. `answer` decides whether a verify passes. */
class FakeWidget {
  region = rect(100, 100, 300, 300);
  targets: Target[] = [
    { id: "t1", rect: rect(110, 110), selected: false },
    { id: "t2", rect: rect(220, 110), selected: false },
    { id: "verify", rect: rect(300, 350, 90, 40), label: "Verify" },
    { id: "reload", rect: rect(110, 350, 40, 40) },
  ];
  errors: string[] = [];
  status: ChallengeView["status"] = "pending";
  gone = false;
  clicks: string[] = [];
  reloads = 0;
  constructor(private readonly passes: (selected: string[], verifies: number) => boolean) {}
  verifies = 0;

  view(): ChallengeView[] {
    if (this.gone) return [];
    return [{ adapter: ADAPTER.id, kind: "select", status: this.status, region: this.region, instruction: "Select t2", errors: this.errors, targets: this.targets, visible: true, frame: "f" }];
  }

  press(p: { x: number; y: number }) {
    const target = this.targets.find((t) => inside(t.rect, p));
    if (!target) return;
    this.clicks.push(target.id);
    if (target.id === "reload") {
      this.reloads++;
      this.errors = [];
      for (const t of this.targets) t.selected &&= false;
    } else if (target.id === "verify") {
      this.verifies++;
      const selected = this.targets.filter((t) => t.selected).map((t) => t.id);
      if (this.passes(selected, this.verifies)) this.status = "solved";
      else {
        this.errors = ["Please try again."];
        for (const t of this.targets) t.selected &&= false;
      }
    } else target.selected = !target.selected;
  }
}

function fakeDriver(widget: FakeWidget, hooks: { onScan?: (n: number) => void } = {}) {
  const published: [PageState, string][] = [];
  let scans = 0;
  const driver: Driver = {
    input: {
      viewport: async () => rect(0, 0, 1280, 800),
      screenshot: async () => ({ image: "shot", scale: 1 }),
      mouse: async (steps: MouseStep[]) => {
        const press = steps.find((s) => s.type === "mousePressed");
        if (press) widget.press(press);
      },
      type: async () => {},
    },
    images: {
      crop: async () => "frame",
      label: async () => "labeled",
      motion: async () => ({ boxes: [], changed: 0 }),
    },
    scan: async () => {
      hooks.onScan?.(++scans);
      return widget.view();
    },
    reveal: async () => {},
    puzzle: async () => null,
    snapshot: async () => "<html>challenge</html>",
    publish: async (state, detail) => void published.push([state, detail]),
    url: async () => "https://site.test/form",
  };
  return { driver, published };
}

const decision = (...targets: string[]): Decision => ({
  reasoning: "mock",
  actions: targets.map((target) => ({ kind: "click", target, text: null, x: null, y: null, toX: null, toY: null })),
});

/** A model that answers with `answer()` and records the prompts it got. */
function model(answer: () => Decision | Error) {
  const prompts: string[] = [];
  const m = new MockLanguageModelV4({
    doGenerate: async (options) => {
      const user = options.prompt.find((p) => p.role === "user")!;
      prompts.push((user.content as { type: string; text?: string }[]).filter((p) => p.type === "text").map((p) => p.text).join("\n"));
      const value = answer();
      if (value instanceof Error) throw value;
      return {
        content: [{ type: "text", text: JSON.stringify(value) }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
        warnings: [],
      };
    },
  });
  return { m, prompts };
}

const options = { adapters: [ADAPTER], random: seeded(1), maxRounds: 6 };

describe("solve loop", () => {
  it("moves on to the fallback model when a model call fails", async () => {
    const widget = new FakeWidget((selected) => selected.join() === "t2");
    const broken = model(() => new Error("provider down"));
    const good = model(() => decision("t2", "verify"));
    const { driver, published } = fakeDriver(widget);
    const result = await solve(driver, { ...options, models: [broken.m, good.m] });
    expect(result.state).toBe("solved");
    expect(result.rounds[0]!.error).toContain("provider down");
    expect(broken.prompts).toHaveLength(1);
    expect(good.prompts).toHaveLength(1);
    expect(published.map(([s]) => s)).toEqual(["solving", "solved"]);
  });

  it("asks the widget for a new puzzle after two rejected rounds, with a fresh history", async () => {
    // The first two verifies are rejected whatever was selected; the third passes.
    const widget = new FakeWidget((_, n) => n >= 3);
    const { m, prompts } = model(() => decision("t1", "verify"));
    const { driver } = fakeDriver(widget);
    const result = await solve(driver, { ...options, models: [m] });
    expect(result.state).toBe("solved");
    expect(widget.reloads).toBe(1);
    expect(widget.clicks).toEqual(["t1", "verify", "t1", "verify", "reload", "t1", "verify"]);
    expect(prompts[1]).toContain("errors afterwards: Please try again.");
    // After the reload, the old puzzle's rounds no longer apply.
    expect(prompts[2]).not.toContain("Previous rounds");
    expect(result.rounds.map((r) => r.errorsAfter)).toEqual([["Please try again."], ["Please try again."], []]);
  });

  it("drops an answer when the challenge moved while the model thought", async () => {
    const widget = new FakeWidget(() => true);
    const { m } = model(() => decision("t2", "verify"));
    // Scan 2 is the check right before acting: the page scrolled by 40 px.
    const { driver } = fakeDriver(widget, {
      onScan: (n) => {
        if (n === 2) {
          widget.region = { ...widget.region, y: widget.region.y + 40 };
          widget.targets = widget.targets.map((t) => ({ ...t, rect: { ...t.rect, y: t.rect.y + 40 } }));
        }
      },
    });
    const result = await solve(driver, { ...options, models: [m] });
    expect(result.rounds[0]!.error).toBe("challenge moved while the model thought; answer dropped");
    // The second round used the new positions and solved it.
    expect(result.state).toBe("solved");
    expect(widget.clicks).toEqual(["t2", "verify"]);
  });

  it("waits a few scans before taking a vanished challenge as solved", async () => {
    const widget = new FakeWidget(() => true);
    widget.status = "waiting";
    let scans = 0;
    const { driver } = fakeDriver(widget, { onScan: (n) => (scans = n) });
    setTimeout(() => (widget.gone = true), 300);
    const result = await solve(driver, { ...options, models: [] });
    expect(result).toMatchObject({ state: "solved", detail: "challenge gone" });
    // Seen once or more, then three empty scans.
    expect(scans).toBeGreaterThanOrEqual(4);
  });

  it("reports idle without publishing when there was never a challenge", async () => {
    const widget = new FakeWidget(() => true);
    widget.gone = true;
    const { driver, published } = fakeDriver(widget);
    expect(await solve(driver, { ...options, models: [] })).toMatchObject({ state: "idle" });
    expect(published).toEqual([]);
  });

  it("ends a stalled model call at the deadline, as failed with the frame snapshot", async () => {
    const widget = new FakeWidget(() => true);
    const hanging = new MockLanguageModelV4({ doGenerate: (opts) => new Promise((_, reject) => opts.abortSignal?.addEventListener("abort", () => reject(opts.abortSignal!.reason))) });
    const { driver, published } = fakeDriver(widget);
    const started = Date.now();
    const result = await solve(driver, { ...options, models: [hanging], timeoutMs: 1500 });
    expect(Date.now() - started).toBeLessThan(4000);
    expect(result).toMatchObject({ state: "failed", detail: "timed out", snapshot: { adapter: "fake-grid", html: "<html>challenge</html>" } });
    expect(published.at(-1)).toEqual(["failed", "timed out"]);
  });

  it("fails without a model instead of looping", async () => {
    const widget = new FakeWidget(() => true);
    const { driver } = fakeDriver(widget);
    expect(await solve(driver, { ...options, models: [] })).toMatchObject({ state: "failed", detail: "fake-grid: no model configured" });
  });
});
