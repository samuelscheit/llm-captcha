import type { CdpHost, CdpSession } from "./driver";

/** The parts of a Playwright (or patchright) page this host uses. */
interface PwFrame {
  isDetached(): boolean;
}
interface PwSession extends CdpSession {
  detach(): Promise<void>;
}
interface PwPage {
  mainFrame(): PwFrame;
  frames(): PwFrame[];
  context(): { newCDPSession(target: PwPage | PwFrame): Promise<PwSession> };
}

/**
 * CDP sessions of a Playwright page. Playwright opens a session for a frame only when it renders
 * out of process and does not expose frame ids, so frames are matched by their session's root
 * frame id.
 */
export async function playwrightHost(page: PwPage): Promise<CdpHost & { dispose(): Promise<void> }> {
  const context = page.context();
  const pageSession = await context.newCDPSession(page);
  /** Out-of-process frame sessions with their root frame id; undefined for in-process frames. */
  const sessions = new Map<PwFrame, Promise<{ id: string; session: PwSession } | undefined>>();
  const open = async (frame: PwFrame) => {
    const session = await context.newCDPSession(frame).catch(() => undefined);
    if (!session) return undefined;
    const { frameTree } = await session.send("Page.getFrameTree");
    return { id: frameTree.frame.id as string, session };
  };
  return {
    page: pageSession,
    async frameSession(frameId) {
      const live = page.frames().filter((f) => f !== page.mainFrame() && !f.isDetached());
      for (const [frame, entry] of sessions) {
        if (!live.includes(frame)) {
          void entry.then((e) => e?.session.detach().catch(() => {}));
          sessions.delete(frame);
        }
      }
      for (const frame of live) if (!sessions.has(frame)) sessions.set(frame, open(frame).catch(() => undefined));
      const entries = await Promise.all(sessions.values());
      return entries.find((e) => e?.id === frameId)?.session;
    },
    async dispose() {
      await Promise.all([...sessions.values()].map(async (e) => (await e)?.session.detach().catch(() => {})));
      await pageSession.detach().catch(() => {});
    },
  };
}
