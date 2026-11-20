import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";
import { buildPrompt, SYSTEM_PROMPT, type ImageFrame, type MotionHint } from "./prompt";
import type { Action, ChallengeView, Decision, HistoryEntry, ModelConfig } from "./types";

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
  return { reasoning: decision.reasoning, actions: decision.actions.filter(valid) };
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
  const { output } = await generateText({
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
  });
  return sanitize(output, input.view, input.frame);
}

export async function testModel(config: ModelConfig): Promise<string> {
  const { text } = await generateText({ model: createModel(config), prompt: "Reply with the single word: ok", maxRetries: 0 });
  return text.trim();
}
