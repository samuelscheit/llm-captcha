// Page fixtures: real (sanitized) challenge pages from fixtures/<provider>/<name>/page.html,
// solved by every driver exactly as captured.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { harness, type DriverKind, type Harness } from "../support/drivers";
import { PAGE_FIXTURES, startServer, type TestServer } from "../support/server";

let server: TestServer;
beforeAll(async () => (server = await startServer()));
afterAll(() => server?.close());

describe.each<DriverKind>(["extension", "playwright", "puppeteer"])("%s driver on page fixtures", (kind) => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness(kind, { provider: "openai-compatible", baseURL: server.modelURL, apiKey: "mock", model: "mock" });
  });
  afterAll(() => h?.close());

  it("has page fixtures", () => expect(PAGE_FIXTURES.length).toBeGreaterThan(0));

  it.each(PAGE_FIXTURES.map((f) => [f.name, f] as const))("%s", async (_, fixture) => {
    const url = `${server.origin}/fixture/${fixture.name}`;
    if (kind === "extension") {
      // The extension acts by itself; a page that navigates away on success is judged by where it lands.
      await h.raw!.goto(url);
    } else {
      const result = await h.solve(url);
      expect(result.state, result.detail).toBe(fixture.expected.state);
    }
    if (fixture.expected.navigatesTo) await expect.poll(() => h.page.url(), { timeout: 60_000 }).toContain(fixture.expected.navigatesTo);
  });
});
