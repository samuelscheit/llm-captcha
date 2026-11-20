import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { harness, type DriverKind, type Harness } from "../support/drivers";
import { startServer, TEST_ADAPTERS, type TestServer } from "../support/server";

let server: TestServer;
beforeAll(async () => (server = await startServer()));
afterAll(() => server?.close());

describe("extension without a model (assist mode)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness("extension", { provider: "openai-compatible", baseURL: "", apiKey: "", model: "" }, TEST_ADAPTERS);
  });
  afterAll(() => h?.close());

  it("puts the challenge to the driving agent in the page and acts on its answer", async () => {
    const calls = server.state.modelCalls.length;
    const verified = server.state.gridVerified;
    const page = h.raw!;
    await page.goto(`${server.origin}/host?widget=grid`);
    // The agent's view: a dialog with the labeled challenge, the syntax and a labeled input.
    const panel = page.locator("#llm-captcha-assist section[role=dialog]");
    await panel.waitFor({ timeout: 30_000 });
    expect(await page.evaluate(() => document.documentElement.dataset.captchaDetail)).toBe("test-grid: answer needed in the captcha panel");
    expect(await panel.locator(".instruction").textContent()).toBe("Select all images with circles");
    expect(await panel.locator(".help").textContent()).toContain("t1 t2 t3 t4 t5 t6 t7 t8 t9 verify");
    expect(await panel.locator("img").getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    // The challenge sits left: the panel goes right, off it.
    expect(await panel.getAttribute("class")).toBe("panel right");

    // A wrong id is refused in place, with a reason.
    await page.getByLabel("Captcha answer").fill("t99");
    await page.getByLabel("Captcha answer").press("Enter");
    await expect.poll(() => panel.locator(".error").textContent()).toContain('Unknown target "t99"');

    const circles = server.state.grid.flatMap((s, i) => (s === "circle" ? [`t${i + 1}`] : []));
    await page.getByLabel("Captcha answer").fill(`${circles.join(" ")} verify`);
    await page.getByLabel("Captcha answer").press("Enter");
    await page.waitForFunction(() => document.documentElement.dataset.captchaState === "solved", null, { timeout: 30_000 });
    expect(server.state.gridVerified).toBe(verified + 1);
    expect(await page.locator("#llm-captcha-assist").count()).toBe(0);
    expect(server.state.modelCalls.length).toBe(calls);
  });
});

describe.each<DriverKind>(["extension", "playwright", "puppeteer"])("%s driver on local challenges", (kind) => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness(kind, { provider: "openai-compatible", baseURL: server.modelURL, apiKey: "mock", model: "mock" }, TEST_ADAPTERS);
  });
  afterAll(() => h?.close());

  it("reads a text captcha below the fold, scrolls to it and types the answer", async () => {
    server.mock.wrongFirst = 0;
    const result = await h.solve(`${server.origin}/text`);
    expect(result.state).toBe("solved");
    expect(await h.page.inputValue("input[name=captcha]")).toBe(server.state.text);
    await h.page.click("button");
    await expect.poll(() => h.page.textContent("#result")).toBe("correct");
    const call = server.state.modelCalls.at(-1)!;
    expect(call.prompt).toContain("Challenge type: text (text-image)");
    // 180x60 region is upscaled 2x for the model.
    expect(call.prompt).toContain("Screenshot: 360x120 px.");
    expect(call.image).toMatch(/^data:image\/png;base64,/);
  });

  it("selects grid tiles in a cross-site iframe, learns from a wrong round, then verifies", async () => {
    server.mock.wrongFirst = 1;
    const calls = server.state.modelCalls.length;
    const verified = server.state.gridVerified;
    const result = await h.solve(`${server.origin}/host?widget=grid&offset=900`);
    expect(result.state, result.detail).toBe("solved");
    expect(server.state.gridVerified).toBe(verified + 1);
    const prompts = server.state.modelCalls.slice(calls).map((c) => c.prompt);
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("- t9: x=");
    expect(prompts[0]).not.toContain("Previous rounds");
    // The second round sees the first one's actions and the error the widget showed after it.
    expect(prompts[1]).toContain("Previous rounds:");
    expect(prompts[1]).toContain("errors afterwards: Please try again.");
    expect(result.rounds[0]!.errorsAfter).toEqual(["Please try again."]);
    // Replacement tiles fade in for 1.5 s: the model is asked only once they finished.
    const second = server.state.modelCalls.slice(calls)[1]!;
    expect(second.at - server.state.gridLoadedAt).toBeGreaterThanOrEqual(1500);
  });

  it("clicks a canvas point exactly through iframe border, padding and scroll", async () => {
    server.mock.wrongFirst = 0;
    const clicks = server.state.pointClicks.length;
    const result = await h.solve(`${server.origin}/host?widget=point&offset=1200`);
    expect(result.state, result.detail).toBe("solved");
    const [click] = server.state.pointClicks.slice(clicks);
    expect(Math.hypot(click!.x - server.state.point.x, click!.y - server.state.point.y)).toBeLessThan(3);
    // A static canvas: three frames, nothing moved, so the model gets one labeled image.
    const call = server.state.modelCalls.at(-1)!;
    expect(call.images).toBe(1);
    expect(call.prompt).toContain("Screenshot: 446x");
  });

  it("drags a Tencent slide puzzle into its gap by image analysis, without the model", async () => {
    const calls = server.state.modelCalls.length;
    const solved = server.state.tencent.solved;
    const misses = server.state.tencent.misses.length;
    const result = await h.solve(`${server.origin}/host?widget=tencent/cap_union_new_show&offset=300`);
    expect(result.state, result.detail).toBe("solved");
    expect(server.state.tencent.solved).toBe(solved + 1);
    // First try, within 4 px of the gap.
    expect(server.state.tencent.misses.slice(misses)).toHaveLength(1);
    expect(server.state.tencent.misses.at(-1)).toBeLessThanOrEqual(4);
    expect(server.state.modelCalls.length).toBe(calls);
  });

  it("finds the moving object in an animation from a burst of frames", async () => {
    const calls = server.state.modelCalls.length;
    const misses = server.state.animMisses.length;
    const result = await h.solve(`${server.origin}/host?widget=anim&offset=0`);
    expect(result.state, result.detail).toBe("solved");
    const call = server.state.modelCalls.slice(calls)[0]!;
    expect(call.images).toBe(3);
    expect(call.prompt).toContain("Screenshots: 3 frames 300 ms apart");
    // Only the moving circle is a moving region; the decoys stand still.
    expect(call.prompt).toMatch(/- m1: x=\d+/);
    expect(call.prompt).not.toContain("- m2:");
    expect(server.state.animMisses.slice(misses)[0]).toBeLessThan(30);
  });
});
