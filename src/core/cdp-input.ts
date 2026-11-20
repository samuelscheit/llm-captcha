import type { Input } from "./driver";
import { between, type MouseStep, type RandomSource } from "./mouse";
import type { Rect } from "./types";

/** Send one CDP command on the top-level page's session. */
export type CdpSend = (method: string, params?: Record<string, unknown>) => Promise<any>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Trusted input over CDP. Mouse events go to the page session in top-level coordinates and the
 * browser routes them to whichever (out-of-process) frame is under the pointer. Gestures run with
 * focus emulation: widgets record document.hasFocus(), which a background window would fail. It
 * stays on: Playwright enables it itself, and a chrome.debugger detach resets it.
 */
export class CdpInput implements Input {
  constructor(
    private readonly send: CdpSend,
    private readonly random: RandomSource = Math.random,
  ) {}

  async viewport(): Promise<Rect> {
    const { cssLayoutViewport: v } = await this.send("Page.getLayoutMetrics");
    return { x: 0, y: 0, width: v.clientWidth, height: v.clientHeight };
  }

  /**
   * Never clipped: a clipped capture applies its own device metrics and afterwards resets those
   * another session set (Puppeteer's and Playwright's viewport emulation), which reflows the page.
   */
  async screenshot(): Promise<{ image: string; scale: number }> {
    const [{ data }, metrics] = await Promise.all([this.send("Page.captureScreenshot", { format: "png" }), this.send("Page.getLayoutMetrics")]);
    // Device pixels per CSS pixel. Both widths leave out a classic scrollbar, the screenshot does
    // not, so the PNG width cannot serve here.
    return { image: data, scale: metrics.layoutViewport.clientWidth / metrics.cssLayoutViewport.clientWidth };
  }

  async mouse(steps: MouseStep[]): Promise<void> {
    await this.withFocus(async () => {
      for (const step of steps) {
        await this.send("Input.dispatchMouseEvent", {
          type: step.type,
          x: step.x,
          y: step.y,
          button: step.type === "mouseMoved" && step.buttons === 0 ? "none" : "left",
          buttons: step.buttons,
          ...(step.type === "mouseMoved" ? {} : { clickCount: 1 }),
        });
        if (step.delayMs > 0) await sleep(step.delayMs);
      }
    });
  }

  async type(text: string): Promise<void> {
    await this.withFocus(async () => {
      for (const char of text) {
        const code = /^[a-z]$/i.test(char) ? `Key${char.toUpperCase()}` : /^\d$/.test(char) ? `Digit${char}` : undefined;
        await this.send("Input.dispatchKeyEvent", { type: "keyDown", key: char, code, text: char, unmodifiedText: char });
        await this.send("Input.dispatchKeyEvent", { type: "keyUp", key: char, code });
        await sleep(between(this.random, 50, 160));
      }
    });
  }

  private focused?: Promise<unknown>;

  private async withFocus<T>(run: () => Promise<T>): Promise<T> {
    await (this.focused ??= this.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {}));
    return run();
  }
}
