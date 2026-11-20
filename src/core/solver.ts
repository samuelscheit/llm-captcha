import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, NoObjectGeneratedError, Output, type LanguageModel, type LanguageModelUsage } from "ai";
import { z } from "zod";
import { buildPrompt, SYSTEM_PROMPT, type ImageFrame, type MotionHint } from "./prompt";
import type { Action, ChallengeView, Decision, HistoryEntry, ModelConfig, TokenUsage } from "./types";

const ActionSchema = z.object({
  kind: z.enum(["click", "type", "clickPoint", "drag", "wait"]),
  target: z.string().nullable(),
  text: z.string().nullable(),
  x: z.number().nullable(),
  y: z.number().nullable(),
  toX: z.number().nullable(),
  toY: z.number().nullable(),
});

export const DecisionSchema = z.object({
  reasoning: z.string(),
  actions: z.array(ActionSchema),
});

/**
 * The decision in a model's text when the provider ignored the requested response format (some
 * gateways drop it): the last parseable JSON object, fenced or bare, with prose around it.
 */
export function recoverDecision(text: string): Decision | null {
  const candidates = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]!);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
  for (const candidate of candidates.reverse()) {
    try {
      const parsed = DecisionSchema.safeParse(JSON.parse(candidate));
      if (parsed.success) return parsed.data;
    } catch {}
  }
  return null;
}

/**
 * The model of a configuration. `fetch` replaces the global one for the provider's requests, e.g.
 * to send them through an egress proxy.
 */
export function createModel(config: ModelConfig, options: { fetch?: typeof globalThis.fetch } = {}): LanguageModel {
  const baseURL = config.baseURL.trim() || undefined;
  const { fetch } = options;
  switch (config.provider) {
    case "openai":
      return createOpenAI({ apiKey: config.apiKey, baseURL, fetch })(config.model);
    case "anthropic":
      // Requests from an extension carry an Origin header; Anthropic refuses those without opt-in.
      return createAnthropic({ apiKey: config.apiKey, baseURL, fetch, headers: { "anthropic-dangerous-direct-browser-access": "true" } })(config.model);
    case "google":
      return createGoogle({ apiKey: config.apiKey, baseURL, fetch })(config.model);
    case "openai-compatible":
      if (!baseURL) throw new Error("An OpenAI-compatible provider needs a base URL.");
      return createOpenAICompatible({ name: "custom", baseURL, apiKey: config.apiKey, fetch, supportsStructuredOutputs: true })(config.model);
  }
}

/** Drop actions that cannot be executed: unknown targets, missing coordinates or text. */
export function sanitize(decision: Decision, view: ChallengeView, image: ImageFrame): Decision {
  const ids = new Set(view.targets.map((t) => t.id));
  const inImage = (x: number | null, y: number | null) => x !== null && y !== null && x >= 0 && y >= 0 && x <= image.width && y <= image.height;
  const valid = (a: Action) => {
    switch (a.kind) {
      case "click":
        return !!a.target && ids.has(a.target);
      case "type":
        return !!a.target && ids.has(a.target) && !!a.text;
      case "clickPoint":
        return inImage(a.x, a.y);
      case "drag":
        return inImage(a.x, a.y) && inImage(a.toX, a.toY);
      case "wait":
        return true;
    }
  };
  return { ...decision, actions: decision.actions.filter(valid) };
}

/** The SDK's usage in our shape; undefined when the provider reported none. */
export function tokenUsage(usage: LanguageModelUsage | undefined): TokenUsage | undefined {
  if (usage?.inputTokens === undefined && usage?.outputTokens === undefined) return undefined;
  const { cacheReadTokens, cacheWriteTokens } = usage.inputTokenDetails ?? {};
  return {
    input: usage.inputTokens ?? 0,
    output: usage.outputTokens ?? 0,
    ...(cacheReadTokens ? { cacheRead: cacheReadTokens } : {}),
    ...(cacheWriteTokens ? { cacheWrite: cacheWriteTokens } : {}),
  };
}

export interface DecideInput {
  view: ChallengeView;
  history: HistoryEntry[];
  /** PNG base64, oldest first; the last is the labeled current screen. */
  images: string[];
  frame: ImageFrame;
  motion?: MotionHint;
}

export async function decide(model: LanguageModel, input: DecideInput, signal?: AbortSignal): Promise<Decision> {
  const output = await generateText({
    model,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: buildPrompt(input.view, input.frame, input.history, input.motion) },
          ...input.images.map((data) => ({ type: "file" as const, data, mediaType: "image/png" })),
        ],
      },
    ],
    output: Output.object({ schema: DecisionSchema }),
    maxRetries: 1,
    abortSignal: signal,
  }).then(
    (result) => ({ ...result.output, usage: tokenUsage(result.usage) }),
    (error) => {
      const recovered = NoObjectGeneratedError.isInstance(error) && error.text ? recoverDecision(error.text) : null;
      if (!recovered) throw error;
      return { ...recovered, usage: tokenUsage(error.usage) };
    },
  );
  return sanitize(output, input.view, input.frame);
}

export async function testModel(config: ModelConfig): Promise<string> {
  const { text } = await generateText({ model: createModel(config), prompt: "Reply with the single word: ok", maxRetries: 0 });
  return text.trim();
}
