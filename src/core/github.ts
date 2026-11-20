import type { SolveResult } from "./engine";
import { fixtureFiles, providerOf, roundDir, type FixtureFile } from "./fixture";
import { formatAction } from "./prompt";
import type { ReportConfig } from "./types";

/** A failed session, as it is reported. */
export interface FailureReport {
  result: SolveResult;
  /** Page URL; query and fragment are dropped before reporting. */
  url: string;
  model: string;
  /** Solver build (commit), to tell fixed failures from new ones. */
  build: string;
}

export const REPORT_LABEL = "challenge-failure";
/** Rounds of a session that go into a report: the last ones carry the failure. */
const ROUNDS_REPORTED = 4;

const pageOf = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return "";
  }
};

/** Which challenge failed how: equal titles are one issue. Numbers are dropped (round counts). */
export function reportTitle(report: FailureReport): string {
  const adapter = report.result.snapshot?.adapter ?? report.result.rounds.at(-1)?.adapter ?? report.result.detail.split(":")[0]!;
  const detail = report.result.detail.replace(/^[\w-]+:\s*/, "").replace(/\d+/g, "N");
  return `[${providerOf(adapter)}] ${adapter}: ${detail}`;
}

/** Whether a failure says something about the solver (not a vendor block or a missing setup). */
export function isReportable(result: SolveResult): boolean {
  return result.state === "failed" && !/blocked|no model configured/.test(result.detail);
}

/** Files of a report, relative to the fixture repository root. */
export function reportFiles(report: FailureReport): FixtureFile[] {
  const rounds = report.result.rounds.slice(-ROUNDS_REPORTED);
  const files = rounds.flatMap((record) =>
    fixtureFiles({ ...record, url: pageOf(record.url) }, report.model).map((f) => ({ ...f, path: `fixtures/captured/${roundDir(record)}/${f.path}` })),
  );
  const snapshot = report.result.snapshot;
  if (snapshot) {
    const dir = rounds.length ? `fixtures/captured/${roundDir(rounds.at(-1)!)}` : `fixtures/captured/${providerOf(snapshot.adapter)}/${Date.now()}-${snapshot.adapter}`;
    files.push({ path: `${dir}/dom.html`, content: snapshot.html, encoding: "utf-8" });
  }
  return files;
}

type Fetch = typeof fetch;

function client(token: string, fetchImpl: Fetch) {
  return async <T = any>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await fetchImpl(`https://api.github.com${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) throw new Error(`GitHub ${method} ${path}: ${response.status} ${(await response.text()).slice(0, 300)}`);
    return (await response.json()) as T;
  };
}

/** Push files as one commit on a new branch off the default branch, through the git data API. */
async function pushBranch(api: ReturnType<typeof client>, repo: string, branch: string, files: FixtureFile[], message: string): Promise<void> {
  const { default_branch } = await api<{ default_branch: string }>("GET", `/repos/${repo}`);
  const head = await api<{ object: { sha: string } }>("GET", `/repos/${repo}/git/ref/heads/${default_branch}`);
  const base = await api<{ tree: { sha: string } }>("GET", `/repos/${repo}/git/commits/${head.object.sha}`);
  const tree = await Promise.all(
    files.map(async (f) => {
      const blob = await api<{ sha: string }>("POST", `/repos/${repo}/git/blobs`, { content: f.content, encoding: f.encoding });
      return { path: f.path, mode: "100644", type: "blob", sha: blob.sha };
    }),
  );
  const newTree = await api<{ sha: string }>("POST", `/repos/${repo}/git/trees`, { base_tree: base.tree.sha, tree });
  const commit = await api<{ sha: string }>("POST", `/repos/${repo}/git/commits`, { message, tree: newTree.sha, parents: [head.object.sha] });
  await api("POST", `/repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit.sha });
}

export function reportBody(report: FailureReport, fixtureRepo: string, branch: string, files: FixtureFile[]): string {
  const { result } = report;
  const raw = (path: string) => `https://raw.githubusercontent.com/${fixtureRepo}/${branch}/${path}`;
  const rounds = result.rounds.slice(-ROUNDS_REPORTED);
  const dirs = rounds.map((r) => `fixtures/captured/${roundDir(r)}`);
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  return [
    `**Result:** ${result.state}: ${result.detail}`,
    `**Page:** ${pageOf(report.url)}`,
    `**Build:** ${report.build} · **Model:** ${report.model}`,
    "",
    rounds.length ? "| Round | Instruction | Actions | Errors after | Model error |\n|---|---|---|---|---|" : "_No model round ran._",
    ...rounds.map((r) => `| ${r.round} | ${cell(r.view.instruction)} | ${cell(r.actions.map(formatAction).join("; "))} | ${cell((r.errorsAfter ?? []).join(" / "))} | ${cell(r.error ?? "")} |`),
    "",
    ...rounds.flatMap((r, i) => (files.some((f) => f.path === `${dirs[i]}/labeled.png`) ? [`Round ${r.round}, as the model saw it:`, `![round ${r.round}](${raw(`${dirs[i]}/labeled.png`)})`, ""] : [])),
    "### Reproduce",
    "```sh",
    `git fetch https://github.com/${fixtureRepo}.git ${branch} && git checkout FETCH_HEAD -- fixtures/captured`,
    "```",
    "Label a round (set `expected` in its fixture.json), move it to `fixtures/<provider>/<name>/` and run `bun run eval --filter <provider>/<name>`. " +
      (files.some((f) => f.path.endsWith("dom.html")) ? "`dom.html` is the challenge frame's markup, closed shadow roots included, for fixing the adapter." : ""),
  ].join("\n");
}

/**
 * Report a failure: the rounds (fixture format) and the frame snapshot go to a branch of
 * `fixtureRepo`, and an issue in `repo` links them, or a comment when an open issue with the same
 * title exists. Returns the issue or comment URL.
 */
export async function reportToGitHub(config: ReportConfig, report: FailureReport, fetchImpl: Fetch = fetch): Promise<string> {
  const api = client(config.token, fetchImpl);
  const fixtureRepo = config.fixtureRepo || config.repo;
  const title = reportTitle(report);
  const files = reportFiles(report);
  const stamp = new Date(report.result.rounds.at(-1)?.time ?? Date.now()).toISOString().replace(/[:.]/g, "-");
  const branch = `fixtures/${title.match(/^\[(\w+)\]/)?.[1] ?? "unknown"}/${stamp}`;
  await pushBranch(api, fixtureRepo, branch, files, `fixture: ${title}`);
  const body = reportBody(report, fixtureRepo, branch, files);

  const open = await api<{ title: string; number: number; html_url: string }[]>("GET", `/repos/${config.repo}/issues?labels=${REPORT_LABEL}&state=open&per_page=100`);
  const existing = open.find((issue) => issue.title === title);
  if (existing) {
    const comment = await api<{ html_url: string }>("POST", `/repos/${config.repo}/issues/${existing.number}/comments`, { body });
    return comment.html_url;
  }
  const provider = title.match(/^\[(\w+)\]/)?.[1];
  const issue = await api<{ html_url: string }>("POST", `/repos/${config.repo}/issues`, {
    title,
    body,
    labels: [REPORT_LABEL, ...(provider ? [provider] : [])],
  });
  return issue.html_url;
}
