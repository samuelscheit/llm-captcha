import { CdpInput } from "../core/cdp-input";
import type { Driver, ImageTools } from "../core/driver";
import type { AdapterSpec, ChallengeView, PageState } from "../core/types";
import type { AssistRequest } from "../page/assist";
import { crop, label, motion } from "../page/image";
import type { ContentApi } from "./content";

type Api = ContentApi;

/**
 * Driver for one tab: content scripts scan and publish, chrome.debugger delivers trusted input
 * and screenshots. The debugger is attached on first use only; `close` detaches it again so the
 * "started debugging" bar does not stay.
 */
export class ExtensionDriver implements Driver {
  readonly input: CdpInput;
  /** The service worker has OffscreenCanvas: image work runs right here. */
  readonly images: ImageTools = { crop, label, motion };
  private attached?: Promise<void>;

  constructor(private readonly tabId: number) {
    this.input = new CdpInput(async (method, params) => {
      await (this.attached ??= chrome.debugger.attach({ tabId }, "1.3"));
      return chrome.debugger.sendCommand({ tabId }, method, params);
    });
    // The user cancelled the infobar, or the tab crashed or navigated away: attach again on next use.
    chrome.debugger.onDetach.addListener(this.onDetach);
  }

  private readonly onDetach = (source: chrome.debugger.Debuggee) => {
    if (source.tabId === this.tabId) this.attached = undefined;
  };

  async scan(adapters: AdapterSpec[]): Promise<ChallengeView[]> {
    const results = await chrome.scripting.executeScript({
      target: { tabId: this.tabId, allFrames: true },
      func: (adapters: AdapterSpec[]) => (globalThis as unknown as { __captcha?: Api }).__captcha?.scanTop(adapters) ?? [],
      args: [adapters],
    });
    return results.flatMap((r) => ((r.result as ChallengeView[] | undefined) ?? []).map((v) => ({ ...v, frame: String(r.frameId) })));
  }

  async reveal(view: ChallengeView, adapter: AdapterSpec): Promise<void> {
    // executeScript sends only the function's source: callbacks must not close over anything.
    await this.inFrame(Number(view.frame), (spec: AdapterSpec) => (globalThis as unknown as { __captcha: Api }).__captcha.reveal(spec), adapter);
  }

  async puzzle(view: ChallengeView, adapter: AdapterSpec): Promise<{ distance: number; margin: number } | null> {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: this.tabId, frameIds: [Number(view.frame)] },
      func: (spec: AdapterSpec) => (globalThis as unknown as { __captcha: Api }).__captcha.measurePuzzle(spec),
      args: [adapter],
    });
    return (result?.result as { distance: number; margin: number } | null | undefined) ?? null;
  }

  async snapshot(view: ChallengeView): Promise<string> {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: this.tabId, frameIds: [Number(view.frame)] },
      func: () => (globalThis as unknown as { __captcha: Api }).__captcha.snapshot(),
    });
    return (result?.result as string | undefined) ?? "";
  }

  async ask(request: AssistRequest): Promise<string> {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: this.tabId, frameIds: [0] },
      func: (r: AssistRequest) => (globalThis as unknown as { __captcha: Api }).__captcha.ask(r),
      args: [request],
    });
    return (result?.result as string | undefined) ?? "";
  }

  async publish(state: PageState, detail: string): Promise<void> {
    await this.inFrame(0, (state: PageState, detail: string) => (globalThis as unknown as { __captcha: Api }).__captcha.publish(state, detail), state, detail);
  }

  async url(): Promise<string> {
    return (await chrome.tabs.get(this.tabId)).url ?? "";
  }

  async close(): Promise<void> {
    chrome.debugger.onDetach.removeListener(this.onDetach);
    if (this.attached) await chrome.debugger.detach({ tabId: this.tabId }).catch(() => {});
    this.attached = undefined;
  }

  private async inFrame<A extends unknown[]>(frameId: number, func: (...args: A) => void, ...args: A): Promise<void> {
    await chrome.scripting.executeScript({ target: { tabId: this.tabId, frameIds: [frameId] }, func, args });
  }
}
