/**
 * Self-update from the upstream repository: fast-forward, install, build into a staging
 * directory, run the unit tests, then swap the build into dist/. The extension (loaded unpacked
 * from dist/extension) notices the new build.json and reloads itself; CDP library users get the
 * new dist/cdp on their next import.
 *
 *   bun run update                update once
 *   bun run update --install      run hourly (launchd on macOS, cron elsewhere)
 *   bun run update --uninstall
 *
 * Only fast-forwards of a clean checkout are taken: local work is never merged over or lost, and a
 * build that fails its tests never reaches dist/. UPDATE_REMOTE / UPDATE_BRANCH pick the source
 * (default: the branch's upstream).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const LABEL = "dev.llm-captcha-solver.update";
/** The upstream commit whose build or tests failed: not tried again until upstream moves on. */
const REJECTED = path.join(root, ".update-rejected");

const run = (cmd: string, args: string[], env: Record<string, string> = {}) =>
  execFileSync(cmd, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } }).trim();
const git = (...args: string[]) => run("git", args);
const log = (message: string) => console.log(`[update ${new Date().toISOString()}] ${message}`);

function upstream(): string {
  if (process.env.UPDATE_REMOTE) return `${process.env.UPDATE_REMOTE}/${process.env.UPDATE_BRANCH ?? git("rev-parse", "--abbrev-ref", "HEAD")}`;
  return git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}");
}

/** Build into dist.next, test it, swap it in. Throws (dist/ untouched) when anything fails. */
function buildAndSwap(): void {
  const staging = path.join(root, "dist.next");
  rmSync(staging, { recursive: true, force: true });
  run("bun", ["build.ts"], { OUT_DIR: "dist.next" });
  const tests = spawnSync("bunx", ["vitest", "run", "test/unit"], { cwd: root, encoding: "utf8" });
  if (tests.status !== 0) {
    rmSync(staging, { recursive: true, force: true });
    throw new Error(`unit tests failed:\n${(tests.stdout + tests.stderr).slice(-2000)}`);
  }
  const previous = path.join(root, "dist.prev");
  rmSync(previous, { recursive: true, force: true });
  if (existsSync(path.join(root, "dist"))) renameSync(path.join(root, "dist"), previous);
  renameSync(staging, path.join(root, "dist"));
}

function update(): void {
  if (git("status", "--porcelain", "--untracked-files=no")) return log("local changes: not updating (commit or push them first)");
  const target = upstream();
  const [remote, ...branch] = target.split("/");
  git("fetch", "--quiet", remote!, branch.join("/"));
  const head = git("rev-parse", "HEAD");
  const next = git("rev-parse", target);
  if (head === next) return log(`up to date at ${head.slice(0, 7)}`);
  if (existsSync(REJECTED) && readFileSync(REJECTED, "utf8").trim() === next) return log(`${next.slice(0, 7)} failed before: waiting for a newer commit`);
  if (spawnSync("git", ["merge-base", "--is-ancestor", "HEAD", target], { cwd: root }).status !== 0) {
    return log(`${target} is not a fast-forward of HEAD: not updating (local commits?)`);
  }
  git("merge", "--ff-only", "--quiet", target);
  try {
    run("bun", ["install", "--frozen-lockfile"]);
    buildAndSwap();
    log(`updated ${head.slice(0, 7)} → ${next.slice(0, 7)}; the extension reloads within a minute`);
  } catch (error) {
    // Back to the commit dist/ was built from; the generated sources follow it again.
    git("reset", "--keep", head);
    run("bun", ["install", "--frozen-lockfile"]);
    rmSync(path.join(root, "dist.next"), { recursive: true, force: true });
    run("bun", ["build.ts"], { OUT_DIR: "dist.next" });
    rmSync(path.join(root, "dist.next"), { recursive: true, force: true });
    writeFileSync(REJECTED, `${next}\n`);
    log(`update to ${next.slice(0, 7)} failed, stayed on ${head.slice(0, 7)}: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}

function install(): void {
  const bun = run("which", ["bun"]);
  const script = path.join(root, "src/tools/update.ts");
  if (platform() === "darwin") {
    const plist = path.join(homedir(), "Library/LaunchAgents", `${LABEL}.plist`);
    const logFile = path.join(root, "update.log");
    mkdirSync(path.dirname(plist), { recursive: true });
    writeFileSync(
      plist,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${bun}</string><string>${script}</string></array>
  <key>WorkingDirectory</key><string>${root}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${path.dirname(bun)}:/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin</string></dict>
  <key>StartInterval</key><integer>3600</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${logFile}</string>
  <key>StandardErrorPath</key><string>${logFile}</string>
</dict></plist>
`,
    );
    spawnSync("launchctl", ["unload", plist]);
    run("launchctl", ["load", plist]);
    return log(`installed ${plist} (hourly, log: ${logFile})`);
  }
  const line = `0 * * * * cd ${root} && ${bun} ${script} >> ${path.join(root, "update.log")} 2>&1 # ${LABEL}`;
  const current = spawnSync("crontab", ["-l"], { encoding: "utf8" }).stdout ?? "";
  const crontab = current.split("\n").filter((l) => l && !l.includes(LABEL)).concat(line).join("\n") + "\n";
  spawnSync("crontab", ["-"], { input: crontab });
  log("installed hourly cron job");
}

function uninstall(): void {
  if (platform() === "darwin") {
    const plist = path.join(homedir(), "Library/LaunchAgents", `${LABEL}.plist`);
    spawnSync("launchctl", ["unload", plist]);
    rmSync(plist, { force: true });
  } else {
    const current = spawnSync("crontab", ["-l"], { encoding: "utf8" }).stdout ?? "";
    spawnSync("crontab", ["-"], { input: current.split("\n").filter((l) => l && !l.includes(LABEL)).join("\n") + "\n" });
  }
  log("uninstalled");
}

const arg = process.argv[2];
if (arg === "--install") install();
else if (arg === "--uninstall") uninstall();
else update();
