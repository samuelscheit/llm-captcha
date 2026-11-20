import type { ModelConfig } from "../core/types";

/** Content script / options page → service worker. */
export type Message = { type: "wake" } | { type: "test-model"; model: ModelConfig };
