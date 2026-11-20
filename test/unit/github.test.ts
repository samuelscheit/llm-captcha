import { describe, expect, it } from "vitest";
import type { SolveResult } from "../../src/core/engine";
import { isReportable, REPORT_LABEL, reportTitle, reportToGitHub, type FailureReport } from "../../src/core/github";
import type { ReportConfig, RoundRecord } from "../../src/core/types";

const round = (n: number, errorsAfter: string[]): RoundRecord => ({
  time: Date.UTC(2026, 10, 20, 18, 0, n),
  url: "https://shop.example/login?session=secret#x",
  adapter: "recaptcha-images",
  kind: "select",
  round: n,
  reasoning: "cars in t2",
  actions: [{ kind: "click", target: "t2", text: null, x: null, y: null, toX: null, toY: null }],
  ms: 5000,
  view: {
    adapter: "recaptcha-images",
    kind: "select",
    status: "pending",
    region: { x: 0, y: 0, width: 400, height: 580 },
    instruction: "Select all images with | cars",
    errors: [],
    targets: [],
    visible: true,
  },
  history: [],
  frames: ["RnJhbWUx", "RnJhbWUy"],
  labeled: "TGFiZWxlZA==",
  errorsAfter,
});

const failure = (overrides: Partial<SolveResult> = {}): FailureReport => ({
  result: {
    state: "failed",
    detail: "recaptcha-images: not solved in 8 rounds",
    rounds: [round(1, ["Please try again."]), round(2, ["Please try again."])],
    snapshot: { adapter: "recaptcha-images", html: "<html><body>challenge</body></html>" },
    ...overrides,
  },
  url: "https://shop.example/login?session=secret#x",
  model: "claude-opus-5-5",
  build: "abc1234",
});

const config: ReportConfig = { enabled: true, token: "ghp_test", repo: "up/solver", fixtureRepo: "me/solver", maxPerDay: 5 };

/** A fake GitHub API that records calls and answers each route. */
function fakeGitHub(openIssues: { title: string; number: number; html_url: string }[] = []) {
  const calls: { method: string; path: string; body?: any }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const path = url.replace("https://api.github.com", "");
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init.method!, path, body });
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer ghp_test");
    const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
    if (path === "/repos/me/solver") return json({ default_branch: "main" });
    if (path === "/repos/me/solver/git/ref/heads/main") return json({ object: { sha: "head" } });
    if (path === "/repos/me/solver/git/commits/head") return json({ tree: { sha: "basetree" } });
    if (path === "/repos/me/solver/git/blobs") return json({ sha: `blob${calls.filter((c) => c.path.endsWith("/blobs")).length}` });
    if (path === "/repos/me/solver/git/trees") return json({ sha: "newtree" });
    if (path === "/repos/me/solver/git/commits") return json({ sha: "newcommit" });
    if (path === "/repos/me/solver/git/refs") return json({ ref: body.ref });
    if (path.startsWith("/repos/up/solver/issues?")) return json(openIssues);
    if (path === "/repos/up/solver/issues") return json({ html_url: "https://github.com/up/solver/issues/7" });
    if (path.match(/^\/repos\/up\/solver\/issues\/\d+\/comments$/)) return json({ html_url: "https://github.com/up/solver/issues/3#c1" });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe("reportToGitHub", () => {
  it("pushes the rounds and the snapshot to a fixture branch and files a labeled issue", async () => {
    const gh = fakeGitHub();
    const url = await reportToGitHub(config, failure(), gh.fetchImpl);
    expect(url).toBe("https://github.com/up/solver/issues/7");

    const tree = gh.calls.find((c) => c.path.endsWith("/git/trees"))!.body;
    expect(tree.base_tree).toBe("basetree");
    const paths = tree.tree.map((t: { path: string }) => t.path);
    const dir1 = "fixtures/captured/recaptcha/2026-11-20T18-00-01-000Z-recaptcha-images-r1";
    const dir2 = "fixtures/captured/recaptcha/2026-11-20T18-00-02-000Z-recaptcha-images-r2";
    expect(paths).toEqual([
      `${dir1}/fixture.json`, `${dir1}/frame-1.png`, `${dir1}/frame-2.png`, `${dir1}/labeled.png`,
      `${dir2}/fixture.json`, `${dir2}/frame-1.png`, `${dir2}/frame-2.png`, `${dir2}/labeled.png`,
      `${dir2}/dom.html`,
    ]);
    // Order of the git data calls: blobs, tree, commit on top of the default branch, then the ref.
    const commit = gh.calls.find((c) => c.path.endsWith("/git/commits") && c.method === "POST")!.body;
    expect(commit).toMatchObject({ tree: "newtree", parents: ["head"] });
    const ref = gh.calls.find((c) => c.path.endsWith("/git/refs"))!.body;
    expect(ref).toEqual({ ref: "refs/heads/fixtures/recaptcha/2026-11-20T18-00-02-000Z", sha: "newcommit" });

    // Fixture content: query and fragment of the page URL never leave the browser.
    const blobs = gh.calls.filter((c) => c.path.endsWith("/blobs")).map((c) => c.body);
    const fixture = JSON.parse(blobs.find((b) => b.encoding === "utf-8" && b.content.includes('"source"')).content);
    expect(fixture.source).toBe("https://shop.example/login");
    expect(fixture.expected).toBeNull();
    expect(fixture.observed).toMatchObject({ model: "claude-opus-5-5", errorsAfter: ["Please try again."] });
    expect(blobs.find((b) => b.content === "RnJhbWUx")!.encoding).toBe("base64");

    const issue = gh.calls.find((c) => c.path === "/repos/up/solver/issues")!.body;
    expect(issue.title).toBe("[recaptcha] recaptcha-images: not solved in N rounds");
    expect(issue.labels).toEqual([REPORT_LABEL, "recaptcha"]);
    expect(issue.body).toContain("**Page:** https://shop.example/login\n");
    expect(issue.body).not.toContain("secret");
    expect(issue.body).toContain(`https://raw.githubusercontent.com/me/solver/fixtures/recaptcha/2026-11-20T18-00-02-000Z/${dir2}/labeled.png`);
    // Pipes in page text would break the table.
    expect(issue.body).toContain("Select all images with \\| cars");
    expect(issue.body).toContain("git fetch https://github.com/me/solver.git fixtures/recaptcha/2026-11-20T18-00-02-000Z");
  });

  it("comments on the open issue with the same title instead of filing a duplicate", async () => {
    const gh = fakeGitHub([
      { title: "[recaptcha] recaptcha-images: something else", number: 2, html_url: "x" },
      { title: "[recaptcha] recaptcha-images: not solved in N rounds", number: 3, html_url: "y" },
    ]);
    const url = await reportToGitHub(config, failure({ detail: "recaptcha-images: not solved in 6 rounds" }), gh.fetchImpl);
    expect(url).toBe("https://github.com/up/solver/issues/3#c1");
    expect(gh.calls.some((c) => c.path === "/repos/up/solver/issues" && c.method === "POST")).toBe(false);
  });

  it("pushes to the issues repository when no fixture repository is set", async () => {
    const gh = fakeGitHub();
    await reportToGitHub({ ...config, fixtureRepo: "" }, failure(), gh.fetchImpl).catch(() => {});
    expect(gh.calls[0]!.path).toBe("/repos/up/solver");
  });

  it("surfaces GitHub errors with status and message", async () => {
    const fetchImpl = (async () => new Response('{"message":"Bad credentials"}', { status: 401 })) as unknown as typeof fetch;
    await expect(reportToGitHub(config, failure(), fetchImpl)).rejects.toThrow("GitHub GET /repos/me/solver: 401");
  });
});

describe("what gets reported", () => {
  it.each([
    ["recaptcha-images: not solved in 8 rounds", true],
    ["timed out", true],
    ["hcaptcha-challenge: cannot scroll it into view", true],
    ["recaptcha-blocked: blocked", false],
    ["text-image: no model configured", false],
  ])("failed with %s → %s", (detail, reportable) => {
    expect(isReportable({ state: "failed", detail, rounds: [] })).toBe(reportable);
  });
  it("never reports success or idle", () => {
    expect(isReportable({ state: "solved", detail: "x", rounds: [] })).toBe(false);
    expect(isReportable({ state: "idle", detail: "x", rounds: [] })).toBe(false);
  });
  it("titles a failure without rounds by its detail's adapter", () => {
    expect(reportTitle({ ...failure(), result: { state: "failed", detail: "hcaptcha-challenge: cannot scroll it into view", rounds: [] } })).toBe(
      "[hcaptcha] hcaptcha-challenge: cannot scroll it into view",
    );
  });
});
