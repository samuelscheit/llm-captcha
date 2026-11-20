import type { Page } from "patchright";
import puppeteer from "puppeteer-core";
import { puppeteerHost } from "../../src/cdp/puppeteer";
import { BUILTIN_ADAPTERS } from "../../src/core/adapters";
import { solve, type SolveResult } from "../../src/core/engine";
import { createModel } from "../../src/core/solver";
import type { AdapterSpec, ModelConfig, RoundRecord } from "../../src/core/types";
import { CdpDriver } from "../../src/cdp/driver";
import { playwrightHost } from "../../src/cdp/playwright";
import { configure, launch } from "../../src/tools/browser";

export type DriverKind = "extension" | "playwright" | "puppeteer";

/** Puppeteer needs the binary itself; patchright finds Chrome through `channel: "chrome"`. */
const CHROME =
  process.env.CHROME_PATH ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/usr/bin/google-chrome");

/** What the scenarios need from a page, implemented by Playwright and Puppeteer pages. */
export interface TestPage {
  inputValue(selector: string): Promise<string>;
  /** Value of a (possibly hidden) form field by name. */
  fieldValue(name: string): Promise<string>;
  url(): string;
  click(selector: string): Promise<void>;
  textContent(selector: string): Promise<string | null>;
}

export interface Harness {
  page: TestPage;
  /** The Playwright page itself (extension and Playwright harnesses). */
  raw?: Page;
  /** Load `url` and let the driver solve whatever appears; resolves with the final page state. */
  solve(url: string): Promise<{ state: string; detail: string; rounds: RoundRecord[] }>;
  close(): Promise<void>;
}

/** Solve until something was found: challenges render a moment after load. */
async function solveUntilFound(run: () => Promise<SolveResult>, pause: () => Promise<unknown>): Promise<SolveResult> {
  for (let attempt = 0; ; attempt++) {
    const result = await run();
    if (result.state !== "idle" || attempt >= 10) return result;
    await pause();
  }
}

/** The same scenario under each driver: the extension on its own, or the CDP library on Playwright or Puppeteer. */
export async function harness(kind: DriverKind, model: ModelConfig, adapters: AdapterSpec[] = []): Promise<Harness> {
  // Well inside the test timeout: a stuck widget fails with the engine's own detail.
  // Only the library drivers call the model from here; the extension gets it through its settings.
  const engine = () => ({ adapters: [...adapters, ...BUILTIN_ADAPTERS], models: [createModel(model)], maxRounds: 6, timeoutMs: 90_000 });
  if (kind === "puppeteer") {
    // As an agent's browser runs: without announcing automation (navigator.webdriver), which
    // pages check before they even look at a drag.
    const browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: false,
      defaultViewport: { width: 1280, height: 800 },
      ignoreDefaultArgs: ["--enable-automation"],
      args: ["--disable-blink-features=AutomationControlled"],
    });
    const page = (await browser.pages())[0] ?? (await browser.newPage());
    return {
      page: {
        inputValue: (s) => page.$eval(s, (el) => (el as HTMLInputElement).value),
        url: () => page.url(),
        fieldValue: (name) => page.evaluate((n) => (document.querySelector(`[name="${n}"]`) as HTMLInputElement | null)?.value ?? "", name),
        click: (s) => page.click(s),
        textContent: (s) => page.$eval(s, (el) => el.textContent),
      },
      async solve(url) {
        await page.goto(url);
        const host = await puppeteerHost(page);
        try {
          return await solveUntilFound(() => solve(new CdpDriver(host), engine()), () => new Promise((r) => setTimeout(r, 500)));
        } finally {
          await host.dispose();
        }
      },
      close: () => browser.close(),
    };
  }
  const browser = await launch({ extension: kind === "extension" });
  const page = browser.context.pages()[0] ?? (await browser.context.newPage());
  if (kind === "extension") await configure(browser.worker!, { model, customAdapters: adapters, maxRounds: 6 });

  async function solveWithExtension(url: string) {
    const before = (await browser.worker!.evaluate(() => (globalThis as any).__captchaDebug.records.length)) as number;
    await page.goto(url);
    await page.waitForFunction(() => ["solved", "failed"].includes(document.documentElement.dataset.captchaState ?? ""), null, { timeout: 150_000, polling: 250 });
    const [state, detail] = await page.evaluate(() => [document.documentElement.dataset.captchaState!, document.documentElement.dataset.captchaDetail!]);
    const rounds = (await browser.worker!.evaluate((n) => (globalThis as any).__captchaDebug.records.slice(n), before)) as RoundRecord[];
    return { state, detail, rounds };
  }

  async function solveWithPlaywright(url: string): Promise<SolveResult> {
    await page.goto(url);
    const host = await playwrightHost(page);
    try {
      return await solveUntilFound(() => solve(new CdpDriver(host), engine()), () => page.waitForTimeout(500));
    } finally {
      await host.dispose();
    }
  }

  return {
    page: {
      inputValue: (s) => page.inputValue(s),
      url: () => page.url(),
      fieldValue: (name) => page.evaluate((n) => (document.querySelector(`[name="${n}"]`) as HTMLInputElement | null)?.value ?? "", name),
      click: (s) => page.click(s),
      textContent: (s) => page.textContent(s),
    },
    raw: page,
    solve: kind === "extension" ? solveWithExtension : solveWithPlaywright,
    close: () => browser.close(),
  };
}
