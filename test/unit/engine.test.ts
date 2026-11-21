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
      compose: async () => "sheet",
    },
    scan: async () => {
      hooks.onScan?.(++scans);
      return widget.view();
    },
    reveal: async () => {},
    uncover: async () => {},
    puzzle: async () => null,
    snapshot: async () => "<html>challenge</html>",
    publish: async (state, detail) => void published.push([state, detail]),
    url: async () => "https://site.test/form",
    document: async () => (widget as { document?: string }).document ?? "doc-1",
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

  it("takes a challenge as passed only after it stayed away for 4 s", async () => {
    const widget = new FakeWidget(() => true);
    widget.status = "waiting";
    const { driver } = fakeDriver(widget);
    let goneAt = 0;
    setTimeout(() => ((widget.gone = true), (goneAt = Date.now())), 300);
    const result = await solve(driver, { ...options, models: [] });
    expect(result).toMatchObject({ state: "solved", detail: "challenge gone" });
    expect(Date.now() - goneAt).toBeGreaterThanOrEqual(4000);
  });

  it("does not take a widget that only re-renders (gone for a moment) as passed", async () => {
    const widget = new FakeWidget(() => true);
    widget.status = "waiting";
    const { driver } = fakeDriver(widget);
    // Away for 1.5 s, then back: still waiting, later refused for good.
    setTimeout(() => (widget.gone = true), 300);
    setTimeout(() => (widget.gone = false), 1800);
    setTimeout(() => (widget.status = "blocked"), 2500);
    expect(await solve(driver, { ...options, models: [] })).toMatchObject({ state: "failed", detail: "fake-grid: blocked" });
  });

  it("reports idle without publishing when no challenge appeared in time", async () => {
    const widget = new FakeWidget(() => true);
    widget.gone = true;
    const { driver, published } = fakeDriver(widget);
    const started = Date.now();
    expect(await solve(driver, { ...options, models: [], appearMs: 1200 })).toMatchObject({ state: "idle" });
    expect(Date.now() - started).toBeGreaterThanOrEqual(1200);
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

/**
 * A reCAPTCHA-like checkbox whose token lands in a response field of the page `tokenAfterMs`
 * after the click (never when undefined). A cover takes every click until it is hidden.
 */
class FakeCheckbox {
  covered?: string;
  checked = false;
  token = "";
  gone = false;
  appearAt = 0;
  clicks = 0;
  constructor(public tokenAfterMs?: number) {}
  view(): ChallengeView[] {
    if (this.gone || Date.now() < this.appearAt) return [];
    return [{
      adapter: "fake-checkbox", kind: "checkbox", status: this.checked ? "solved" : "pending", region: rect(100, 100, 300, 76), instruction: "", errors: [],
      targets: [{ id: "checkbox", rect: rect(110, 120, 28, 28) }], visible: true, frame: "f", response: this.token, ...(this.covered && { covered: this.covered }),
    }];
  }
  press(p: { x: number; y: number }) {
    if (this.covered || !inside(rect(110, 120, 28, 28), p)) return;
    this.clicks++;
    this.checked = true;
    if (this.tokenAfterMs !== undefined) setTimeout(() => (this.token = "token"), this.tokenAfterMs);
  }
}

const CHECKBOX: AdapterSpec = { id: "fake-checkbox", kind: "checkbox", root: "#anchor", response: "textarea", targets: [] };

describe("checkbox with a response field", () => {
  const solveBox = (widget: FakeCheckbox, extra: { appearMs?: number; timeoutMs?: number } = {}) => {
    const { driver } = fakeDriver(widget as unknown as FakeWidget);
    let uncovers = 0;
    return {
      uncovers: () => uncovers,
      driver,
      result: (cover: () => void = () => (widget.covered = undefined)) => {
        driver.uncover = async () => void (uncovers++, cover());
        return solve(driver, { adapters: [CHECKBOX], random: seeded(3), models: [], ...extra });
      },
    };
  };

  it("hides what covers the checkbox, then clicks it", async () => {
    const widget = new FakeCheckbox(0);
    widget.covered = "div#onetrust-consent-sdk";
    const run = solveBox(widget);
    expect(await run.result()).toMatchObject({ state: "solved", detail: "no challenge left" });
    expect(run.uncovers()).toBe(1);
    expect(widget.clicks).toBe(1);
  });

  it("fails naming the cover when it cannot be hidden, without clicking into it", async () => {
    const widget = new FakeCheckbox(0);
    widget.covered = "div.modal-backdrop";
    const run = solveBox(widget);
    expect(await run.result(() => {})).toMatchObject({ state: "failed", detail: "fake-checkbox: covered by div.modal-backdrop" });
    expect(run.uncovers()).toBe(3);
    expect(widget.clicks).toBe(0);
  });

  it("counts a checked box as solved only once its token is in the page", async () => {
    const widget = new FakeCheckbox(2000);
    const result = await solveBox(widget).result();
    expect(result).toMatchObject({ state: "solved" });
    expect(widget.token).toBe("token");
    expect(widget.clicks).toBe(1);
  });

  it("fails a checked box that disappears without a token instead of calling it solved", async () => {
    const widget = new FakeCheckbox();
    setTimeout(() => (widget.gone = true), 2500);
    expect(await solveBox(widget).result()).toMatchObject({ state: "failed", detail: "fake-checkbox: gone without a response token" });
  }, 15_000);

  it("calls it solved when the page navigated on by itself, token or not (an interstitial passing)", async () => {
    const widget = new FakeCheckbox() as FakeCheckbox & { document?: string };
    setTimeout(() => ((widget.gone = true), (widget.document = "doc-2")), 2500);
    expect(await solveBox(widget, { appearMs: 1500 }).result()).toMatchObject({ state: "solved", detail: "challenge gone" });
  }, 15_000);

  it("solves the challenge the page it navigated to renders a few seconds later", async () => {
    const widget = new FakeCheckbox() as FakeCheckbox & { document?: string };
    setTimeout(() => ((widget.gone = true), (widget.document = "doc-2")), 2500);
    // The new page's widget: unchecked, and it hands over its token.
    setTimeout(() => Object.assign(widget, { gone: false, checked: false, token: "", tokenAfterMs: 0 }), 5000);
    expect(await solveBox(widget, { appearMs: 8000 }).result()).toMatchObject({ state: "solved", detail: "no challenge left" });
    expect(widget.clicks).toBe(2);
    expect(widget.token).toBe("token");
  }, 20_000);

  it("waits for a checkbox that renders seconds after the page", async () => {
    const widget = new FakeCheckbox(0);
    widget.appearAt = Date.now() + 2500;
    expect(await solveBox(widget, { appearMs: 5000 }).result()).toMatchObject({ state: "solved" });
    expect(widget.clicks).toBe(1);
  });
});

/** A carousel (Arkose-like): 5 options, a next arrow, submit; passes on option `answer`. */
class FakeCarousel {
  current = 0;
  submitted: number[] = [];
  status: ChallengeView["status"] = "pending";
  constructor(private readonly answer: number) {}
  view(): ChallengeView[] {
    return [{
      adapter: "fake-carousel", kind: "select", status: this.status, region: rect(100, 100, 300, 300),
      instruction: "Pick the matching image", errors: [], visible: true, frame: "f",
      targets: [
        ...Array.from({ length: 5 }, (_, i) => ({ id: `pip${i + 1}`, rect: rect(120 + i * 20, 380, 10, 10), selected: i === this.current })),
        { id: "right", rect: rect(350, 250, 30, 30) },
        { id: "submit", rect: rect(200, 340, 80, 30) },
      ],
    }];
  }
  press(p: { x: number; y: number }) {
    if (inside(rect(350, 250, 30, 30), p)) this.current = (this.current + 1) % 5;
    else if (inside(rect(200, 340, 80, 30), p)) {
      this.submitted.push(this.current);
      if (this.current === this.answer) this.status = "solved";
    }
  }
}

const CAROUSEL: AdapterSpec = { id: "fake-carousel", kind: "select", root: "#c", targets: [], carousel: { options: "pip", next: "right", submit: "submit" } };

describe("carousel", () => {
  it("pages through every option once, shows the model one sheet, goes to its pick and submits", async () => {
    const widget = new FakeCarousel(3);
    const composed: number[] = [];
    const { driver } = fakeDriver(widget as unknown as FakeWidget);
    driver.images.compose = async (r) => (composed.push(r.parts.length), "sheet");
    const { m, prompts } = model(() => decision("o4"));
    const result = await solve(driver, { adapters: [CAROUSEL], random: seeded(2), maxRounds: 3, models: [m] });
    expect(result.state, result.detail).toBe("solved");
    expect(composed).toEqual([5]);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("- o5: x=");
    expect(prompts[0]).toContain("Click exactly the one option");
    // Back at the start after browsing, then three arrows to option 4, then one submit.
    expect(widget.submitted).toEqual([3]);
  });
});

/** Press & Hold: passes once held for `needMs`, but only when pressed after it armed. */
class FakeHold {
  pressedAt?: number;
  status: ChallengeView["status"] = "pending";
  holds = 0;
  constructor(private readonly needMs: number) {}
  get fill() {
    return this.pressedAt === undefined ? 0 : Math.min(238, ((Date.now() - this.pressedAt) / this.needMs) * 238);
  }
  view(): ChallengeView[] {
    if (this.pressedAt !== undefined && Date.now() - this.pressedAt >= this.needMs) this.status = "solved";
    return [{
      adapter: "fake-hold", kind: "hold", status: this.status, region: rect(100, 100, 240, 100), instruction: "", errors: [], visible: true, frame: "f",
      targets: [{ id: "handle", rect: rect(100, 100, 240, 100) }, { id: "progress", rect: rect(100, 150, this.fill, 4) }],
    }];
  }
  step(s: MouseStep) {
    if (s.type === "mousePressed") (this.pressedAt = Date.now()), this.holds++;
    if (s.type === "mouseReleased" && this.status !== "solved") this.pressedAt = undefined;
  }
}

describe("press and hold", () => {
  it("holds until the widget is done, after waiting for it to arm", async () => {
    const widget = new FakeHold(1200);
    const { driver } = fakeDriver(widget as unknown as FakeWidget);
    driver.input.mouse = async (steps) => steps.forEach((s) => widget.step(s));
    const started = Date.now();
    const result = await solve(driver, { adapters: [{ id: "fake-hold", kind: "hold", root: "#h", targets: [] }], random: seeded(4), maxRounds: 3, models: [] });
    expect(result.state, result.detail).toBe("solved");
    expect(widget.holds).toBe(1);
    // Armed after 2.5–4 s, then held 1.2 s.
    expect(Date.now() - started).toBeGreaterThanOrEqual(3700);
  }, 20_000);
});
