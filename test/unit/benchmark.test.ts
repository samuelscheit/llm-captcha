import { describe, expect, it } from "vitest";
import { categoryOf, expandSources, isPermanent, leaderboard, record, renderLeaderboard, resolveModels, staleJobs, untested, type BenchModel, type BenchResults } from "../../src/tools/benchmark/benchmark";
import { renderSite, renderSvg } from "../../src/tools/benchmark/site";
import type { StoredFixture } from "../../src/tools/fixtures";
import type { ChallengeView } from "../../src/core/types";

const view = (kind: ChallengeView["kind"]): ChallengeView => ({
  adapter: "x",
  kind,
  status: "pending",
  region: { x: 0, y: 0, width: 10, height: 10 },
  instruction: "",
  errors: [],
  targets: [],
  visible: true,
});
const fixture = (name: string, kind: ChallengeView["kind"], frame = "f1"): StoredFixture => ({
  name,
  dir: `/f/${name}`,
  frames: [frame],
  source: "",
  capturedAt: "",
  view: view(kind),
  history: [],
  expected: { clicks: ["t1"] },
  notes: "",
});
const model = (name: string): BenchModel => ({ name, provider: "anthropic", baseURL: "", apiKey: "k", model: name });
const run = (pass: boolean, ms = 1000, at = "2026-11-20T10:00:00Z") => ({ pass, ms, at });

const grid = fixture("recaptcha/a", "select");
const shape = fixture("hcaptcha/b", "point");

describe("models", () => {
  it("fills ${ENV} references and skips models without a key", () => {
    const { ready, skipped } = resolveModels(
      [
        { name: "a", provider: "anthropic", model: "m", baseURL: "${BASE}/v1", apiKey: "${KEY_A}" },
        { name: "b", provider: "openai", model: "${MODEL_B}", baseURL: "", apiKey: "${KEY_B}" },
      ],
      { BASE: "https://gw", KEY_A: "secret", MODEL_B: "gpt" },
    );
    expect(ready).toEqual([{ name: "a", provider: "anthropic", model: "m", baseURL: "https://gw/v1", apiKey: "secret" }]);
    expect(skipped).toEqual(["b"]);
  });
});

describe("staleness", () => {
  it("asks for missing runs, and all runs again when the fixture or solver changed", () => {
    const results: BenchResults = { models: {} };
    expect(staleJobs(results, [model("m")], [grid, shape], "s1", 2).map((j) => [j.fixture.name, j.missing])).toEqual([
      ["recaptcha/a", 2],
      ["hcaptcha/b", 2],
    ]);
    record(results, "m", grid, "s1", run(true));
    record(results, "m", grid, "s1", run(false));
    record(results, "m", shape, "s1", run(true));
    expect(staleJobs(results, [model("m")], [grid, shape], "s1", 2).map((j) => [j.fixture.name, j.missing])).toEqual([["hcaptcha/b", 1]]);
    // A new solver invalidates everything; a relabeled or recaptured fixture only itself.
    expect(staleJobs(results, [model("m")], [grid, shape], "s2", 2)).toHaveLength(2);
    expect(staleJobs(results, [model("m")], [fixture("recaptcha/a", "select", "f2"), shape], "s1", 2).map((j) => [j.fixture.name, j.missing])).toEqual([
      ["recaptcha/a", 2],
      ["hcaptcha/b", 1],
    ]);
  });

  it("replaces the runs of an outdated entry instead of mixing versions", () => {
    const results: BenchResults = { models: {} };
    record(results, "m", grid, "s1", run(false));
    record(results, "m", grid, "s2", run(true));
    expect(results.models.m!["recaptcha/a"]!.runs).toEqual([run(true)]);
  });
});

describe("leaderboard", () => {
  const results: BenchResults = { models: {} };
  record(results, "fast", grid, "s", run(true, 2000, "2026-11-20T10:00:00Z"));
  record(results, "fast", grid, "s", run(false, 3000));
  record(results, "fast", shape, "s", run(true, 1000));
  record(results, "good", grid, "s", run(true, 9000));
  record(results, "good", grid, "s", run(true, 9000));
  record(results, "good", shape, "s", run(true, 9000, "2026-11-21T08:00:00Z"));
  record(results, "old", grid, "older-solver", run(true));

  it("counts every run per category, ranks by pass rate then speed, and keeps older solvers' results", () => {
    const rows = leaderboard(results, ["fast", "good", "old", "never"], [grid, shape]);
    // old and good both pass everything; old is faster.
    expect(rows.map((r) => r.model)).toEqual(["old", "good", "fast"]);
    expect(rows.find((r) => r.model === "old")!.solvers).toEqual(["older-solver"]);
    expect(rows[2]).toMatchObject({
      overall: { passed: 2, total: 3 },
      categories: { "recaptcha/select": { passed: 1, total: 2 }, "hcaptcha/point": { passed: 1, total: 1 } },
      medianMs: 2000,
    });
    expect(rows.find((r) => r.model === "good")!.measuredAt).toBe("2026-11-21T08:00:00Z");
  });

  it("only counts fixtures that still exist, in the version that was measured", () => {
    expect(leaderboard(results, ["fast"], [shape])[0]!.overall).toEqual({ passed: 1, total: 1 });
    expect(leaderboard(results, ["fast"], [fixture("hcaptcha/b", "point", "recaptured")])).toEqual([]);
  });

  it("renders a table with a column per category, fixture counts and solver versions", () => {
    const md = renderLeaderboard(leaderboard(results, ["fast", "good"], [grid, shape]), [grid, shape], "s", ["grok-4"]);
    expect(md).toContain("Updated 2026-11-21 · 2 fixtures · current solver `s`");
    expect(md).toContain("| Model | Overall | hcaptcha/point (1) | recaptcha/select (1) | Median time | Solver |");
    expect(md).toContain("| good | **100% (3/3)** | 100% (1/1) | 100% (2/2) | 9.0s | `s` |");
    expect(md).toContain("| fast | **67% (2/3)** | 100% (1/1) | 50% (1/2) | 2.0s | `s` |");
    expect(md).toContain("Not measured (no API key in this run): grok-4.");
  });

  it("categorizes by provider and challenge kind", () => {
    expect(categoryOf(grid)).toBe("recaptcha/select");
    expect(categoryOf(shape)).toBe("hcaptcha/point");
  });
});

describe("model discovery", () => {
  const gateway = (ids: string[]) =>
    (async (url: string, init: RequestInit) => {
      expect(url).toBe("https://gw.test/v1/models");
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer gk");
      return new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }));
    }) as unknown as typeof fetch;

  it("adds every listed model not excluded, behind explicit models that have a key", async () => {
    const { models, skipped } = await expandSources(
      [
        { name: "claude-opus-5-5", provider: "anthropic", model: "claude-opus-5-5", baseURL: "", apiKey: "${ANTHROPIC_KEY}" },
        { name: "gpt-5.6", provider: "openai", model: "gpt-5.6", baseURL: "", apiKey: "${OPENAI_KEY}" },
        { discover: { baseURL: "${GW}/", apiKey: "${GK}", exclude: "embed|-oss-" } },
      ],
      { ANTHROPIC_KEY: "ak", GW: "https://gw.test/v1", GK: "gk" },
      gateway(["claude-opus-5-5", "gpt-5.6", "gemini-3.8-flash", "text-embed-3", "gpt-oss-120b"]),
    );
    // claude stays explicit (it has a key); gpt-5.6 has none, so the gateway's version replaces it.
    expect(models.map((m) => [m.name, m.provider, m.baseURL])).toEqual([
      ["claude-opus-5-5", "anthropic", ""],
      ["gpt-5.6", "openai-compatible", "https://gw.test/v1"],
      ["gemini-3.8-flash", "openai-compatible", "https://gw.test/v1"],
    ]);
    expect(models.at(-1)!.apiKey).toBe("gk");
    expect(skipped).toEqual([]);
  });

  it("skips a gateway without URL or key instead of failing", async () => {
    const { models, skipped } = await expandSources([{ discover: { baseURL: "${GW}", apiKey: "${GK}" } }], {}, gateway([]));
    expect(models).toEqual([]);
    expect(skipped).toHaveLength(1);
  });

  it("selects only models never measured or refused", () => {
    const results: BenchResults = { models: { measured: {} }, unsupported: { refused: "no image input" } };
    expect(untested(results, [model("measured"), model("refused"), model("fresh")]).map((m) => m.name)).toEqual(["fresh"]);
  });

  it.each([
    [400, true],
    [404, true],
    [422, true],
    [401, true],
    [429, false],
    [408, false],
    [500, false],
    [503, false],
    [undefined, false],
  ])("status %s is permanent: %s", (status, permanent) => expect(isPermanent(status)).toBe(permanent));
});

describe("published leaderboard", () => {
  const results: BenchResults = { models: {} };
  record(results, "a<b>", grid, "s", run(true));
  record(results, "a<b>", shape, "s", run(false));
  const rows = leaderboard(results, ["a<b>"], [grid, shape]);

  it("renders an SVG with a row per model, escaped, and a column per category", () => {
    const svg = renderSvg(rows, [grid, shape]);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).toContain("a&#60;b&#62;");
    expect(svg).not.toContain("a<b>");
    expect(svg).toContain("hcaptcha/point (1)");
    expect(svg).toContain(">50%<");
  });

  it("renders the page with the unsupported models listed", () => {
    const html = renderSite(rows, [grid, shape], "s", { "gpt-oss-120b": "error: image input is not supported" });
    expect(html).toContain("<td class=\"model\">a&#60;b&#62;</td>");
    expect(html).toContain("<b>gpt-oss-120b</b>: error: image input is not supported");
    expect(html).toContain("2 fixtures");
  });
});
