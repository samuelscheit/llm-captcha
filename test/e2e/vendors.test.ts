// Real vendor widgets (network) with their test sitekeys: the checkbox path, no model involved.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { harness, type DriverKind, type Harness } from "../support/drivers";
import { startServer, VENDORS, type TestServer } from "../support/server";

let server: TestServer;
beforeAll(async () => (server = await startServer()));
afterAll(() => server?.close());

describe.each<DriverKind>(["extension", "playwright", "puppeteer"])("%s driver on vendor test widgets", (kind) => {
  let h: Harness;
  beforeAll(async () => {
    // A model that must never be called: checkboxes need none.
    h = await harness(kind, { provider: "openai-compatible", baseURL: server.modelURL, apiKey: "mock", model: "mock" });
  });
  afterAll(() => h?.close());

  /** The adapter each vendor's test widget exercises, as a coverage tag. */
  const ADAPTER = { turnstile: "turnstile", recaptcha: "recaptcha-checkbox", hcaptcha: "hcaptcha-checkbox" } as const;

  it.each((Object.keys(VENDORS) as (keyof typeof VENDORS)[]).map((v) => [v, ADAPTER[v]] as const))("clicks the %s checkbox and gets a token [%s]", async (vendor, _adapter) => {
    const calls = server.state.modelCalls.length;
    const result = await h.solve(`${server.origin}/vendor?kind=${vendor}`);
    expect(result.state, result.detail).toBe("solved");
    await expect.poll(() => h.page.fieldValue(VENDORS[vendor].token), { timeout: 15_000 }).not.toBe("");
    expect(server.state.modelCalls.length).toBe(calls);
  });
});
