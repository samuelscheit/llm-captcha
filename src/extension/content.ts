import type { AdapterSpec, ChallengeView } from "../core/types";
import { offsetRect } from "../page/dom";
import { PAGE_GLOBAL, pageApi } from "../page/index";
import { scanFrame } from "../page/scan";
import { frameOffset, serveFrameOffsets } from "./frames";
import type { Message } from "./messages";
import { adaptersOf, loadSettings } from "./settings";

/** The page API plus `scanTop`: views moved into top-level coordinates through the frame chain. */
export const contentApi = {
  ...pageApi,
  async scanTop(adapters: AdapterSpec[]): Promise<ChallengeView[]> {
    const local = pageApi.scan(adapters);
    if (!local.length) return [];
    const offset = await frameOffset();
    return local.map((view) => ({
      ...view,
      region: offsetRect(view.region, offset.x, offset.y),
      targets: view.targets.map((t) => ({ ...t, rect: offsetRect(t.rect, offset.x, offset.y) })),
      visible: view.visible && offset.visible,
    }));
  },
};
export type ContentApi = typeof contentApi;

Object.assign(globalThis, { [PAGE_GLOBAL]: contentApi });
serveFrameOffsets();

// Wake the service worker when a challenge needs work. It scans all frames itself; a frame reports
// its transition to "pending", and again every few seconds while it stays pending, so a wake lost
// to a worker restart or a run that was just ending is repeated.
const REWAKE_MS = 5000;
let adapters: AdapterSpec[] = [];
let wokeAt = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
function check(): void {
  timer = undefined;
  const pending = scanFrame(adapters).some((v) => v.status === "pending");
  if (!pending) return void (wokeAt = 0);
  if (Date.now() - wokeAt < REWAKE_MS) return;
  wokeAt = Date.now();
  chrome.runtime.sendMessage({ type: "wake" } satisfies Message).catch(() => {});
}
const schedule = () => void (timer ??= setTimeout(check, 300));

chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings) void loadSettings().then((s) => (adapters = adaptersOf(s)));
});
void loadSettings().then((s) => {
  adapters = adaptersOf(s);
  new MutationObserver(schedule).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  // Mutations inside closed shadow roots (Turnstile) are not observable.
  setInterval(schedule, 1000);
  schedule();
});
