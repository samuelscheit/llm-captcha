/**
 * Replays fixtures through models, the way live solving asks them: the same labeling, motion
 * analysis and prompt (`think`), with image work in a blank Chrome page through the CDP driver.
 * Shared by `eval` (one model, detailed) and `bench` (many models, leaderboard).
 */
import { APICallError, RetryError, type LanguageModel } from "ai";
import { BUILTIN_ADAPTERS } from "../core/adapters";
import { isAnimated, think } from "../core/engine";
import { score, type Score } from "../core/score";
import type { Decision } from "../core/types";
import { CdpDriver } from "../cdp/driver";
import { playwrightHost } from "../cdp/playwright";
import { launch } from "./browser";
import type { StoredFixture } from "./fixtures";

export interface ReplayJob<M> {
  fixture: StoredFixture;
  model: M;
  run: number;
}

export interface ReplayResult<M> extends ReplayJob<M>, Score {
  ms: number;
  /** The provider failed (rate limit, outage, refusal of the request): says nothing about the model's answer. */
  infra?: boolean;
  /** HTTP status of a provider failure. */
  status?: number;
  decision?: Decision;
  /** The labeled current frame the model saw. */
  image?: string;
}

/** Run every job, `concurrency` at a time, reporting each result as it lands. */
export async function replay<M>(
  jobs: ReplayJob<M>[],
  modelOf: (model: M) => LanguageModel,
  options: { concurrency: number; onResult: (result: ReplayResult<M>) => void },
): Promise<ReplayResult<M>[]> {
  const browser = await launch();
  const page = browser.context.pages()[0] ?? (await browser.context.newPage());
  await page.goto("about:blank");
  const host = await playwrightHost(page);
  const driver = new CdpDriver(host);
  const results: ReplayResult<M>[] = [];
  let next = 0;
  try {
    await Promise.all(
      Array.from({ length: options.concurrency }, async () => {
        while (next < jobs.length) {
          const job = jobs[next++]!;
          const { fixture } = job;
          const started = Date.now();
          let result: ReplayResult<M>;
          try {
            // Replays judge the model, not the settle check: always ask.
            const animated = isAnimated(fixture.view, BUILTIN_ADAPTERS.find((a) => a.id === fixture.view.adapter));
            const { decision, frame, image } = await think(driver.images, { model: modelOf(job.model) }, fixture.view, fixture.frames, fixture.history, { animated, force: true });
            result = { ...job, ...score(decision, fixture.expected!, frame), ms: Date.now() - started, decision, image };
          } catch (error) {
            const api = APICallError.isInstance(error) ? error : RetryError.isInstance(error) && APICallError.isInstance(error.lastError) ? error.lastError : undefined;
            result = {
              ...job,
              pass: false,
              infra: !!api,
              status: api?.statusCode,
              problems: [`error: ${error instanceof Error ? error.message.slice(0, 300) : error}`],
              ms: Date.now() - started,
            };
          }
          results.push(result);
          options.onResult(result);
        }
      }),
    );
  } finally {
    await host.dispose();
    await browser.close();
  }
  return results;
}
