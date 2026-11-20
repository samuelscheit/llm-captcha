import type { CdpHost, CdpSession } from "./driver";

/** The parts of a Puppeteer page and session this host uses. */
interface PptrSession extends CdpSession {
  connection(): { session(id: string): PptrSession | null } | undefined;
  detach(): Promise<void>;
}
interface PptrPage {
  createCDPSession(): Promise<PptrSession>;
}

/**
 * CDP sessions of a Puppeteer page. An out-of-process frame's target id is its frame id; attaching
 * to it in flat mode makes Puppeteer's connection create the session object for it.
 */
export async function puppeteerHost(page: PptrPage): Promise<CdpHost & { dispose(): Promise<void> }> {
  const pageSession = await page.createCDPSession();
  const sessions = new Map<string, Promise<PptrSession | undefined>>();
  return {
    page: pageSession,
    frameSession(frameId) {
      let session = sessions.get(frameId);
      if (!session) {
        session = pageSession
          .send("Target.attachToTarget", { targetId: frameId, flatten: true })
          .then(({ sessionId }: { sessionId: string }) => pageSession.connection()?.session(sessionId) ?? undefined)
          .catch(() => undefined);
        session.then((s) => s ?? sessions.delete(frameId));
        sessions.set(frameId, session);
      }
      return session;
    },
    async dispose() {
      await Promise.all([...sessions.values()].map(async (s) => (await s)?.detach().catch(() => {})));
      await pageSession.detach().catch(() => {});
    },
  };
}
