/**
 * Models served by the Antigravity CLI (`agy`), as an AI SDK language model, for the tools that run
 * on a developer's machine (bench, eval, capture): it reaches models such as Gemini 4 Neon that
 * have no API key of their own, through the CLI's Google login.
 *
 * One `agy acp` process (Agent Client Protocol over stdio) serves every call; each call is a fresh
 * session in an empty directory with its model set, the prompt and images as one user turn, and
 * the agent's reply text as the answer. The agent asks before using tools; every such request is
 * refused, so the answer comes from the model looking at the images alone.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { LanguageModelV4, LanguageModelV4CallOptions, LanguageModelV4GenerateResult, LanguageModelV4Prompt } from "@ai-sdk/provider";
import { APICallError } from "ai";

type Json = Record<string, any>;

const URL = "agy acp";

/** Failures of the CLI or its backend: outages to the caller, not the model's answer. */
const failure = (message: string, body: unknown = undefined, statusCode?: number) =>
  new APICallError({ message, url: URL, requestBodyValues: body, statusCode, isRetryable: statusCode === undefined || statusCode >= 500 || statusCode === 429 });

class AcpClient {
  private readonly process = Bun.spawn(["agy", "acp", "--disable-telemetry"], { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
  private readonly pending = new Map<number, { resolve: (value: Json) => void; reject: (error: Error) => void }>();
  /** Reply text per session, from its agent_message_chunk updates. */
  private readonly replies = new Map<string, string>();
  private nextId = 0;
  readonly ready: Promise<unknown>;

  constructor() {
    void this.read();
    this.ready = this.call("initialize", { protocolVersion: 1, clientCapabilities: {} });
  }

  private send(message: Json) {
    // Bun buffers the pipe: without a flush, a short message waits until a later write fills it.
    this.process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
    this.process.stdin.flush();
  }

  call(method: string, params: Json): Promise<Json> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.hold();
      this.send({ id, method, params });
    });
  }

  private idle: ReturnType<typeof setTimeout> | undefined;

  /**
   * Stop the agent once it has owed no answer for a while: its open pipe would keep the caller's
   * process alive after its work is done. The next call starts a new one.
   */
  private hold() {
    clearTimeout(this.idle);
    if (!this.pending.size) this.idle = setTimeout(() => this.process.kill(), 2000);
  }

  notify(method: string, params: Json) {
    this.send({ method, params });
  }

  reply(sessionId: string) {
    return this.replies.get(sessionId) ?? "";
  }

  forget(sessionId: string) {
    this.replies.delete(sessionId);
  }

  private async read() {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of this.process.stdout) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) this.handle(JSON.parse(line) as Json);
      }
    }
    if (client === this) client = undefined;
    clearTimeout(this.idle);
    const error = failure(`agy acp exited (code ${await this.process.exited})`);
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }

  private handle(message: Json) {
    if (message.method && message.id !== undefined) {
      // A request of the agent: a tool permission. The answer must come from the images alone.
      this.send({ id: message.id, result: { outcome: { outcome: "cancelled" } } });
    } else if (message.method === "session/update") {
      const { sessionId, update } = message.params;
      if (update.sessionUpdate === "agent_message_chunk" && update.content?.type === "text") this.replies.set(sessionId, this.reply(sessionId) + update.content.text);
    } else if (message.id !== undefined) {
      const waiter = this.pending.get(message.id);
      this.pending.delete(message.id);
      this.hold();
      if (message.error) waiter?.reject(failure(`agy acp: ${message.error.message ?? JSON.stringify(message.error)}`, message.error.data));
      else waiter?.resolve(message.result ?? {});
    }
  }
}

let client: AcpClient | undefined;
const acp = () => (client ??= new AcpClient());

/** The prompt as ACP content: the system prompt first, then the user turn's text and images. */
function content(prompt: LanguageModelV4Prompt): Json[] {
  const blocks: Json[] = [];
  for (const message of prompt) {
    if (message.role === "system") blocks.push({ type: "text", text: message.content });
    else if (message.role === "user") {
      for (const part of message.content) {
        if (part.type === "text") blocks.push({ type: "text", text: part.text });
        else if (part.data.type === "data") {
          const data = typeof part.data.data === "string" ? part.data.data : Buffer.from(part.data.data).toString("base64");
          blocks.push({ type: "image", mimeType: part.mediaType, data });
        } else throw failure(`agy: unsupported file part ${part.data.type}`, undefined, 400);
      }
    } else throw failure(`agy: unsupported ${message.role} message`, undefined, 400);
  }
  blocks.push({ type: "text", text: "Answer from the images and text above alone; do not use any tools or files. Reply with the JSON object only." });
  return blocks;
}

export function agyModel(modelId: string): LanguageModelV4 {
  return {
    specificationVersion: "v4",
    provider: "agy",
    modelId,
    supportedUrls: {},
    async doGenerate(options: LanguageModelV4CallOptions): Promise<LanguageModelV4GenerateResult> {
      const prompt = content(options.prompt);
      const client = acp();
      await client.ready;
      const cwd = mkdtempSync(path.join(tmpdir(), "agy-"));
      const { sessionId } = (await client.call("session/new", { cwd, mcpServers: [] })) as { sessionId: string };
      const cancel = () => client.notify("session/cancel", { sessionId });
      options.abortSignal?.addEventListener("abort", cancel, { once: true });
      try {
        await client.call("session/set_model", { sessionId, modelId });
        const result = await client.call("session/prompt", { sessionId, prompt });
        const text = client.reply(sessionId);
        if (result.stopReason !== "end_turn") throw failure(`agy: turn ended with ${result.stopReason}`, { text });
        const usage = result.usage ?? {};
        return {
          content: [{ type: "text", text }],
          finishReason: { unified: "stop", raw: result.stopReason },
          usage: {
            inputTokens: { total: usage.inputTokens, noCache: undefined, cacheRead: usage.cachedReadTokens || undefined, cacheWrite: usage.cachedWriteTokens || undefined },
            outputTokens: { total: usage.outputTokens, text: undefined, reasoning: usage.thoughtTokens },
            raw: usage,
          },
          warnings: [],
        };
      } finally {
        options.abortSignal?.removeEventListener("abort", cancel);
        client.forget(sessionId);
        void client.call("session/close", { sessionId }).catch(() => {});
      }
    },
    async doStream() {
      throw failure("agy: streaming is not supported", undefined, 400);
    },
  };
}
