import type { LanguageModel } from "ai";
import { createModel } from "../core/solver";
import type { ModelConfig } from "../core/types";
import { agyModel } from "./agy";

/** A model for the tools on this machine: any API provider, or `agy` (the Antigravity CLI's models, no key). */
export type ToolModelConfig = Omit<ModelConfig, "provider"> & { provider: ModelConfig["provider"] | "agy" };

export const needsKey = (config: Pick<ToolModelConfig, "provider">) => config.provider !== "agy";

export const toolModel = (config: ToolModelConfig): LanguageModel =>
  config.provider === "agy" ? agyModel(config.model) : createModel({ ...config, provider: config.provider });

/**
 * The real model for capture and eval, from the environment: LLM_PROVIDER (default anthropic; `agy`
 * for the Antigravity CLI), LLM_BASE_URL (default: the provider's endpoint), LLM_API_KEY (not for
 * agy), LLM_MODEL (default claude-opus-5-5).
 */
export function liveModel(): ToolModelConfig {
  const env = process.env;
  const provider = (env.LLM_PROVIDER as ToolModelConfig["provider"] | undefined) ?? "anthropic";
  if (needsKey({ provider }) && !env.LLM_API_KEY) throw new Error("Set LLM_API_KEY (and LLM_PROVIDER / LLM_BASE_URL / LLM_MODEL as needed).");
  return { provider, baseURL: env.LLM_BASE_URL ?? "", apiKey: env.LLM_API_KEY ?? "", model: env.LLM_MODEL ?? "claude-opus-5-5" };
}
