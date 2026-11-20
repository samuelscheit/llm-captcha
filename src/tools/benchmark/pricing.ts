/**
 * API list prices of a model call, from pydantic's genai-prices (bundled price data; a dev
 * dependency: only the leaderboard needs it). Gateway model ids are looked up as they are.
 */
import { calcPrice } from "@pydantic/genai-prices";
import type { TokenUsage } from "../../core/types";

/**
 * USD of one call at list price, or undefined for a model genai-prices does not know. Priced as a
 * fresh request, all input uncached: live, every challenge image is new, while the benchmark
 * replays each fixture several times and some providers cache it automatically (the second run
 * then reads ~all input from cache), which would make repeat runs and those providers look cheap.
 */
export function priceOf(model: string, usage: TokenUsage): number | undefined {
  const price = calcPrice({ input_tokens: usage.input, output_tokens: usage.output }, model);
  return price ? price.total_price : undefined;
}
