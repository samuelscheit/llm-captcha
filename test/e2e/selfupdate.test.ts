// The extension notices a rebuilt dist/ (new build.json on disk) and reloads into it.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { configure, EXTENSION_DIR, launch } from "../../src/tools/browser";

const reloadIfRebuilt = () => (globalThis as any).__captchaDebug.reloadIfRebuilt();

it("reloads into a rebuilt extension only when auto-reload is on", async () => {
  const file = path.join(EXTENSION_DIR, "build.json");
  const original = readFileSync(file, "utf8");
  const b = await launch({ extension: true });
  const worker = b.worker!;
  try {
    expect(await worker.evaluate(() => (globalThis as any).__captchaDebug.build.id)).toBe(JSON.parse(original).id);
    // Same build on disk, auto-reload on: nothing to do.
    await configure(worker, { autoReload: true });
    await worker.evaluate(reloadIfRebuilt);
    expect(b.context.serviceWorkers()).toContain(worker);

    writeFileSync(file, JSON.stringify({ commit: "next", id: "next@later" }));
    // New build, auto-reload off (how CDP-loaded extensions run): stays.
    await configure(worker, { autoReload: false });
    await worker.evaluate(reloadIfRebuilt);
    expect(b.context.serviceWorkers()).toContain(worker);

    // New build, auto-reload on: chrome.runtime.reload(). For a CDP-loaded extension that unloads
    // it (a normally loaded one comes back from disk), so the worker going away proves the reload.
    await configure(worker, { autoReload: true });
    await worker.evaluate(reloadIfRebuilt).catch(() => {});
    await expect.poll(() => b.context.serviceWorkers().includes(worker), { timeout: 10_000 }).toBe(false);
  } finally {
    writeFileSync(file, original);
    await b.close();
  }
});
