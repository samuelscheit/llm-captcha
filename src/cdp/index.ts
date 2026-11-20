import { BUILTIN_ADAPTERS } from "../core/adapters";
import { solve, type EngineOptions, type SolveResult } from "../core/engine";
import { CdpDriver, type CdpHost } from "./driver";

export { BUILTIN_ADAPTERS } from "../core/adapters";
export { solve, type EngineOptions, type SolveResult } from "../core/engine";
export { createModel } from "../core/solver";
export { isReportable, reportToGitHub, type FailureReport } from "../core/github";
export { BUILD } from "../core/build-info.generated";
export type { AdapterSpec, ModelConfig, RoundRecord } from "../core/types";
export { CdpDriver, type CdpHost, type CdpSession } from "./driver";
export { playwrightHost } from "./playwright";
export { puppeteerHost } from "./puppeteer";

/** Solve every challenge on the host's page once; built-in adapters unless others are given. */
export function solveCaptchas(host: CdpHost, options: Partial<EngineOptions> = {}): Promise<SolveResult> {
  return solve(new CdpDriver(host, options.random), { adapters: BUILTIN_ADAPTERS, ...options });
}
