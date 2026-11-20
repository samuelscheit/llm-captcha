import type { ModelConfig } from "../core/types";

/**
 * The real model for capture and eval, from the environment: LLM_PROVIDER (default anthropic),
 * LLM_BASE_URL (default: the provider's endpoint), LLM_API_KEY, LLM_MODEL (default claude-opus-5-5).
 */
export function liveModel(): ModelConfig {
  const env = process.env;
  if (!env.LLM_API_KEY) throw new Error("Set LLM_API_KEY (and LLM_PROVIDER / LLM_BASE_URL / LLM_MODEL as needed).");
  return {
    provider: (env.LLM_PROVIDER as ModelConfig["provider"] | undefined) ?? "anthropic",
    baseURL: env.LLM_BASE_URL ?? "",
    apiKey: env.LLM_API_KEY,
    model: env.LLM_MODEL ?? "claude-opus-5-5",
  };
}
