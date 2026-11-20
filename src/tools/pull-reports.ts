/**
 * Pull reported failures into fixtures/captured/ for labeling: every fixture branch named in the
 * open `challenge-failure` issues (and their comments) of the repository.
 *
 *   bun run pull-reports [--repo owner/name] [--issue N]
 *
 * The repository defaults to the `origin` remote; the token to $GITHUB_TOKEN or `gh auth token`.
 * Each restored round gets an `issue.txt` with the issue URL, so the fix can close it.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { REPORT_LABEL } from "../core/github";
import { CAPTURED_DIR } from "./fixtures";

const root = path.resolve(import.meta.dirname, "../..");
const { values } = parseArgs({ options: { repo: { type: "string" }, issue: { type: "string" } } });
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

const repo = values.repo ?? git("remote", "get-url", "origin").match(/github\.com[:/]([\w.-]+\/[\w.-]+?)(\.git)?$/)?.[1];
if (!repo) throw new Error("No GitHub repository: pass --repo owner/name.");
const token = process.env.GITHUB_TOKEN ?? spawnSync("gh", ["auth", "token"], { encoding: "utf8" }).stdout?.trim();

async function api<T>(apiPath: string): Promise<T> {
  const response = await fetch(`https://api.github.com${apiPath}`, {
    headers: { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  if (!response.ok) throw new Error(`GitHub ${apiPath}: ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

interface Issue {
  number: number;
  title: string;
  html_url: string;
  body: string | null;
}

const issues = values.issue
  ? [await api<Issue>(`/repos/${repo}/issues/${values.issue}`)]
  : await api<Issue[]>(`/repos/${repo}/issues?labels=${REPORT_LABEL}&state=open&per_page=100`);

const FETCH = /git fetch (https:\/\/github\.com\/[\w.-]+\/[\w.-]+\.git) (fixtures\/[\w./-]+)/g;
const listCaptured = () =>
  existsSync(CAPTURED_DIR)
    ? readdirSync(CAPTURED_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).flatMap((d) => readdirSync(path.join(CAPTURED_DIR, d.name)).map((n) => `${d.name}/${n}`))
    : [];

for (const issue of issues) {
  const comments = await api<{ body: string }[]>(`/repos/${repo}/issues/${issue.number}/comments?per_page=100`);
  const texts = [issue.body ?? "", ...comments.map((c) => c.body)];
  const branches = [...new Set(texts.flatMap((t) => [...t.matchAll(FETCH)].map((m) => `${m[1]} ${m[2]}`)))];
  console.log(`#${issue.number} ${issue.title}: ${branches.length} report(s)`);
  for (const entry of branches) {
    const [url, branch] = entry.split(" ") as [string, string];
    const before = new Set(listCaptured());
    const fetched = spawnSync("git", ["fetch", "--quiet", url, branch], { cwd: root, encoding: "utf8" });
    if (fetched.status !== 0) {
      console.log(`  ${branch}: fetch failed (${fetched.stderr.trim()})`);
      continue;
    }
    // Into the working tree only: fixtures/captured/ is not tracked until a round is labeled.
    git("restore", "--source=FETCH_HEAD", "--worktree", "--", "fixtures/captured");
    for (const dir of listCaptured().filter((d) => !before.has(d))) {
      writeFileSync(path.join(CAPTURED_DIR, dir, "issue.txt"), `${issue.html_url}\n`);
      console.log(`  → fixtures/captured/${dir}`);
    }
  }
}
