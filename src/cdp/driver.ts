import { CdpInput } from "../core/cdp-input";
import type { Driver, ImageTools } from "../core/driver";
import type { RandomSource } from "../core/mouse";
import type { AdapterSpec, ChallengeView, PageState } from "../core/types";
import type { AssistRequest } from "../page/assist";
import { PAGE_SOURCE } from "./page-source.generated";

/** One CDP session: the page's, or an out-of-process frame's. */
export interface CdpSession {
  send(method: string, params?: Record<string, unknown>): Promise<any>;
}

/** Where the sessions come from: Playwright, Puppeteer, or a raw connection. */
export interface CdpHost {
  /** Session of the top-level page target. Input and screenshots go here. */
  page: CdpSession;
  /**
   * Session of an out-of-process (site-isolated) frame; its target id is its frame id. Undefined
   * when the frame renders in its parent's process or is gone.
   */
  frameSession(frameId: string): Promise<CdpSession | undefined>;
}

interface FrameNode {
  frame: { id: string; url: string; loaderId: string };
  childFrames?: FrameNode[];
}

interface LiveFrame {
  id: string;
  parentId?: string;
  url: string;
  session: CdpSession;
  context: number;
}

interface DomNode {
  backendNodeId: number;
  shadowRootType?: string;
  children?: DomNode[];
  shadowRoots?: DomNode[];
  contentDocument?: DomNode;
}

const WORLD = "captcha-solver";

/** Runs on an iframe element in its parent's isolated world: its content box in that viewport. */
function ownerBox(this: HTMLIFrameElement) {
  const r = this.getBoundingClientRect();
  const s = getComputedStyle(this);
  const shown = this.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && r.width > 1 && r.height > 1;
  return {
    x: r.x + this.clientLeft + parseFloat(s.paddingLeft),
    y: r.y + this.clientTop + parseFloat(s.paddingTop),
    // Vendors park hidden challenge frames far outside the document (top: -10000px).
    visible: shown && r.right + scrollX > 0 && r.bottom + scrollY > 0,
  };
}

/**
 * Driver over plain CDP. The page code runs in an isolated world per frame, invisible to page
 * scripts; out-of-process frames are reached through their own sessions.
 */
export class CdpDriver implements Driver {
  readonly input: CdpInput;
  /** Isolated world per frame document (frame id + loader id). */
  private readonly worlds = new Map<string, Promise<number>>();
  private frames = new Map<string, LiveFrame>();

  constructor(
    private readonly host: CdpHost,
    random?: RandomSource,
  ) {
    this.input = new CdpInput((method, params) => host.page.send(method, params), random);
  }

  async scan(adapters: AdapterSpec[]): Promise<ChallengeView[]> {
    this.frames = await this.liveFrames();
    const pierceUrls = adapters.filter((a) => a.pierce).map((a) => new RegExp(a.url ?? "", "i"));
    const offsets = new Map<string, Promise<{ x: number; y: number; visible: boolean }>>();
    const offsetOf = (id: string): Promise<{ x: number; y: number; visible: boolean }> => {
      let offset = offsets.get(id);
      if (!offset) offsets.set(id, (offset = this.frameOffset(id, offsetOf)));
      return offset;
    };
    const perFrame = await Promise.all(
      [...this.frames.values()].map(async (frame) => {
        try {
          if (pierceUrls.some((re) => re.test(frame.url))) await this.seedShadows(frame);
          const local = (await this.call(frame, (adapters: AdapterSpec[]) => (globalThis as any).__captcha.scan(adapters), adapters)) as ChallengeView[];
          if (!local.length) return [];
          const o = await offsetOf(frame.id);
          return local.map((v) => ({
            ...v,
            frame: frame.id,
            region: { ...v.region, x: v.region.x + o.x, y: v.region.y + o.y },
            targets: v.targets.map((t) => ({ ...t, rect: { ...t.rect, x: t.rect.x + o.x, y: t.rect.y + o.y } })),
            visible: v.visible && o.visible,
          }));
        } catch {
          // A frame that navigated or detached mid-scan shows up again next scan.
          return [];
        }
      }),
    );
    return perFrame.flat();
  }

  async reveal(view: ChallengeView, adapter: AdapterSpec): Promise<void> {
    const frame = this.frames.get(view.frame ?? "");
    if (frame) await this.call(frame, (spec: AdapterSpec) => (globalThis as any).__captcha.reveal(spec), adapter);
  }

  /** Image work runs in the top frame's isolated world. */
  readonly images: ImageTools = {
    crop: async (r) => (await this.onMain((r) => (globalThis as any).__captcha.images.crop(r), r)) as string,
    label: async (r) => (await this.onMain((r) => (globalThis as any).__captcha.images.label(r), r)) as string,
    motion: async (r) => (await this.onMain((r) => (globalThis as any).__captcha.images.motion(r), r)) as Awaited<ReturnType<ImageTools["motion"]>>,
    compose: async (r) => (await this.onMain((r) => (globalThis as any).__captcha.images.compose(r), r)) as string,
  };

  async puzzle(view: ChallengeView, adapter: AdapterSpec): Promise<{ distance: number; margin: number } | null> {
    const frame = this.frames.get(view.frame ?? "");
    if (!frame) return null;
    return (await this.call(frame, (spec: AdapterSpec) => (globalThis as any).__captcha.measurePuzzle(spec), adapter)) as { distance: number; margin: number } | null;
  }

  /** Every frame's URL, visible element tree and HTML (closed shadow roots included), for writing adapters. */
  async inspect(): Promise<{ url: string; skeleton: string; html: string }[]> {
    this.frames = await this.liveFrames();
    const frames = [...this.frames.values()];
    // Closed shadow roots only open up to the page code once seeded.
    await Promise.all(frames.map((f) => this.seedShadows(f).catch(() => {})));
    return Promise.all(
      frames.map(async (frame) => ({
        url: frame.url,
        skeleton: (await this.call(frame, () => (globalThis as any).__captcha.skeleton()).catch((e: Error) => `(unreadable: ${e.message})`)) as string,
        html: (await this.call(frame, () => (globalThis as any).__captcha.snapshot()).catch(() => "")) as string,
      })),
    );
  }

  async snapshot(view: ChallengeView): Promise<string> {
    const frame = this.frames.get(view.frame ?? "");
    return frame ? ((await this.call(frame, () => (globalThis as any).__captcha.snapshot())) as string) : "";
  }

  async ask(request: AssistRequest): Promise<string> {
    return (await this.onMain((r: AssistRequest) => (globalThis as any).__captcha.ask(r), request)) as string;
  }

  async publish(state: PageState, detail: string): Promise<void> {
    await this.onMain((s: PageState, d: string) => (globalThis as any).__captcha.publish(s, d), state, detail);
  }

  /** Call in the top frame; after a navigation its world is gone, so look the frames up again once. */
  private async onMain<A extends unknown[]>(fn: (...args: A) => unknown, ...args: A): Promise<unknown> {
    try {
      return await this.call(await this.mainFrame(), fn, ...args);
    } catch {
      this.frames = await this.liveFrames();
      return this.call(await this.mainFrame(), fn, ...args);
    }
  }

  async url(): Promise<string> {
    const { frameTree } = await this.host.page.send("Page.getFrameTree");
    return frameTree.frame.url;
  }

  private async mainFrame(): Promise<LiveFrame> {
    const main = [...this.frames.values()].find((f) => !f.parentId);
    if (main) return main;
    this.frames = await this.liveFrames();
    return [...this.frames.values()].find((f) => !f.parentId)!;
  }

  /**
   * Every frame document with an isolated world in it. A session's frame tree holds only the
   * frames its process renders; out-of-process frames are `iframe` targets whose `parentFrameId`
   * names their owner, found round by round so nested ones are reached too.
   */
  private async liveFrames(): Promise<Map<string, LiveFrame>> {
    const frames = new Map<string, LiveFrame>();
    const walk = async (session: CdpSession, node: FrameNode, parentId: string | undefined): Promise<void> => {
      const context = await this.world(session, node.frame).catch(() => undefined);
      if (context === undefined) return;
      frames.set(node.frame.id, { id: node.frame.id, parentId, url: node.frame.url, session, context });
      await Promise.all((node.childFrames ?? []).map((child) => walk(session, child, node.frame.id)));
    };
    const treeOf = async (session: CdpSession) => ((await session.send("Page.getFrameTree").catch(() => ({}))) as { frameTree?: FrameNode }).frameTree;
    const root = await treeOf(this.host.page);
    if (root) await walk(this.host.page, root, undefined);

    const tried = new Set<string>();
    for (;;) {
      const { targetInfos } = (await this.host.page.send("Target.getTargets")) as { targetInfos: { targetId: string; type: string; parentFrameId?: string }[] };
      const next = targetInfos.filter((t) => t.type === "iframe" && t.parentFrameId && frames.has(t.parentFrameId) && !tried.has(t.targetId));
      if (!next.length) {
        // Worlds of documents that are gone (navigated, detached) are dead weight.
        const live = new Set([...frames.values()].map((f) => f.context));
        for (const [key, world] of this.worlds) void world.then((context) => live.has(context) || this.worlds.delete(key), () => {});
        return frames;
      }
      await Promise.all(
        next.map(async (t) => {
          tried.add(t.targetId);
          const session = await this.host.frameSession(t.targetId).catch(() => undefined);
          const tree = session && (await treeOf(session));
          if (session && tree) await walk(session, tree, t.parentFrameId);
        }),
      );
    }
  }

  private world(session: CdpSession, frame: FrameNode["frame"]): Promise<number> {
    const key = `${frame.id}:${frame.loaderId}`;
    let world = this.worlds.get(key);
    if (!world) {
      world = (async () => {
        const { executionContextId } = await session.send("Page.createIsolatedWorld", { frameId: frame.id, worldName: WORLD });
        const { exceptionDetails } = await session.send("Runtime.evaluate", { expression: PAGE_SOURCE, contextId: executionContextId });
        // A failed injection must not stay cached as a usable world.
        if (exceptionDetails) throw new Error(`page code failed in ${frame.url}: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
        return executionContextId as number;
      })();
      world.catch(() => this.worlds.delete(key));
      this.worlds.set(key, world);
    }
    return world;
  }

  private async call<A extends unknown[]>(frame: LiveFrame, fn: (...args: A) => unknown, ...args: A): Promise<unknown> {
    const { result, exceptionDetails } = await frame.session.send("Runtime.callFunctionOn", {
      functionDeclaration: fn.toString(),
      executionContextId: frame.context,
      arguments: args.map((value) => ({ value })),
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  }

  /** A frame's viewport origin in top-level coordinates, from its owner element in the parent. */
  private async frameOffset(id: string, offsetOf: (id: string) => Promise<{ x: number; y: number; visible: boolean }>) {
    const frame = this.frames.get(id);
    const parent = frame?.parentId ? this.frames.get(frame.parentId) : undefined;
    if (!frame?.parentId) return { x: 0, y: 0, visible: true };
    if (!parent) return { x: 0, y: 0, visible: false };
    const { backendNodeId } = await parent.session.send("DOM.getFrameOwner", { frameId: id });
    const { object } = await parent.session.send("DOM.resolveNode", { backendNodeId, executionContextId: parent.context });
    const { result } = await parent.session.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration: ownerBox.toString(),
      returnByValue: true,
    });
    await parent.session.send("Runtime.releaseObject", { objectId: object.objectId }).catch(() => {});
    const box = result.value as { x: number; y: number; visible: boolean };
    const base = await offsetOf(parent.id);
    return { x: base.x + box.x, y: base.y + box.y, visible: base.visible && box.visible };
  }

  /** Hand the frame's closed shadow roots to its page code; scripts cannot reach them otherwise. */
  private async seedShadows(frame: LiveFrame): Promise<void> {
    const { root } = (await frame.session.send("DOM.getDocument", { depth: -1, pierce: true })) as { root: DomNode };
    const pairs: number[] = [];
    const walk = (node: DomNode, host?: DomNode) => {
      if (host && node.shadowRootType === "closed") pairs.push(host.backendNodeId, node.backendNodeId);
      for (const child of node.children ?? []) walk(child);
      for (const shadow of node.shadowRoots ?? []) walk(shadow, node);
      if (node.contentDocument) walk(node.contentDocument);
    };
    walk(root);
    if (!pairs.length) return;
    const objects = await Promise.all(
      pairs.map((backendNodeId) =>
        frame.session
          .send("DOM.resolveNode", { backendNodeId, executionContextId: frame.context })
          .then((r: { object: { objectId: string } }) => r.object.objectId)
          // Roots of other frames' documents do not resolve in this world.
          .catch(() => undefined),
      ),
    );
    const args: { objectId: string }[] = [];
    for (let i = 0; i < objects.length; i += 2) {
      if (objects[i] && objects[i + 1]) args.push({ objectId: objects[i]! }, { objectId: objects[i + 1]! });
    }
    if (!args.length) return;
    await frame.session.send("Runtime.callFunctionOn", {
      functionDeclaration: "function (...pairs) { globalThis.__captcha.seedShadows(...pairs) }",
      executionContextId: frame.context,
      arguments: args,
    });
    await Promise.all(args.map(({ objectId }) => frame.session.send("Runtime.releaseObject", { objectId }).catch(() => {})));
  }
}
