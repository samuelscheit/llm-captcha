import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type BrowserContext, type Worker } from "patchright";
import type { Settings } from "../core/types";

export const EXTENSION_DIR = path.resolve(import.meta.dirname, "../../dist/extension");

export interface Browser {
  context: BrowserContext;
  /** The extension's service worker, when loaded with the extension. */
  worker?: Worker;
  close(): Promise<void>;
}

/**
 * Headful local Chrome (patchright), optionally with the built extension. Branded Chrome 137+
 * ignores --load-extension; over the debugging pipe, CDP Extensions.loadUnpacked still works.
 */
export async function launch(options: { extension?: boolean } = {}): Promise<Browser> {
  const profile = mkdtempSync(path.join(tmpdir(), "captcha-profile-"));
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chrome",
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: options.extension ? ["--enable-unsafe-extension-debugging"] : [],
  });
  let worker: Worker | undefined;
  if (options.extension) {
    const session = await context.browser()!.newBrowserCDPSession();
    const { id } = (await session.send("Extensions.loadUnpacked" as never, { path: EXTENSION_DIR } as never)) as { id: string };
    await session.detach();
    const ours = (w: Worker) => w.url().startsWith(`chrome-extension://${id}/`);
    worker = context.serviceWorkers().find(ours) ?? (await context.waitForEvent("serviceworker", { predicate: ours, timeout: 15_000 }));
    // Loaded through CDP: a self-reload would unload it. Each launch loads the current dist/.
    await configure(worker, { autoReload: false });
  }
  return {
    context,
    worker,
    async close() {
      await context.close();
      rmSync(profile, { recursive: true, force: true });
    },
  };
}

/** Write extension settings, merged over the defaults. */
export async function configure(worker: Worker, settings: Partial<Settings>): Promise<void> {
  await worker.evaluate(async (patch) => {
    const { settings: current } = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({ settings: { ...(current as object), ...patch } });
  }, settings);
}
