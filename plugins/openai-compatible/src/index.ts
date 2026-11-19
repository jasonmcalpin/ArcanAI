import type {
  JsonRecord, Message, ModelPlugin, PluginExecutionRequest, PluginStreamEvent, ToolCall,
} from "arcanai";

export interface OpenAICompatiblePluginConfig {
  /** Explicit operator-selected root ending in /v1/ or a local equivalent. */
  baseUrl: string;
  /** Credentials are injected by the host; never stored in model cards. */
  apiKey?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
}
export class OpenAICompatibleError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "OpenAICompatibleError";
  }
}
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
function validUrl(value: string): URL {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) ||
      url.username || url.password || url.search || url.hash) {
    throw new OpenAICompatibleError("INVALID_ENDPOINT",
      "Provider base URL must be an explicit HTTP(S) endpoint without embedded credentials");
  }
  return url;
}
function content(message: Message): string {
  if (typeof message.content === "string") return message.content;
  if (message.content.some(part => part.type !== "text")) {
    throw new OpenAICompatibleError("UNSUPPORTED_CONTENT",
      "This adapter supports text input only");
  }
  return message.content.map(part => part.type === "text" ? part.text : "").join("");
}
function messagesToWire(messages: Message[]): unknown[] {
  return messages.map(message => {
    if (message.role === "tool") {
      if (typeof message.toolCallId !== "string" || !message.toolCallId ||
          message.toolName === undefined) {
        throw new OpenAICompatibleError("INVALID_TOOL_HISTORY",
          "Tool receipts require the original call ID and name");
      }
      return { role: "tool", tool_call_id: message.toolCallId, content: content(message) };
    }
    if (message.toolCallId || message.toolName) {
      throw new OpenAICompatibleError("INVALID_TOOL_HISTORY",
        "Only tool-role messages may carry tool-result IDs");
    }
    if (message.toolCalls?.length && message.role !== "assistant") {
      throw new OpenAICompatibleError("INVALID_TOOL_HISTORY", "Only assistants issue tool calls");
    }
    return {
      role: message.role, content: content(message),
      ...(message.toolCalls?.length ? { tool_calls: message.toolCalls.map(call => ({
        id: call.id, type: "function", function: {
          name: call.name, arguments: JSON.stringify(call.arguments)
        }
      })) } : {}),
    };
  });
}
function bodyFor(request: PluginExecutionRequest): Record<string, unknown> {
  const allowed = new Set(["tools", "tool_choice", "response_format", "seed", "stop", "frequency_penalty", "presence_penalty"]);
  const options: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(request.providerOptions)) {
    if (!allowed.has(key)) throw new OpenAICompatibleError("UNSUPPORTED_OPTION",
      "Unsupported OpenAI-compatible option: " + key);
    options[key] = value;
  }
  if (options.tools !== undefined && !Array.isArray(options.tools)) {
    throw new OpenAICompatibleError("INVALID_OPTIONS", "tools must be an array");
  }
  return {
    model: request.model, messages: messagesToWire(request.messages), stream: true,
    stream_options: { include_usage: true },
    ...(request.options.temperature === undefined ? {} : { temperature: request.options.temperature }),
    ...(request.options.topP === undefined ? {} : { top_p: request.options.topP }),
    ...(request.options.maxTokens === undefined ? {} : { max_tokens: request.options.maxTokens }),
    ...options,
  };
}
async function* sseLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let remaining = "";
  try {
    while (true) {
      const chunk = await reader.read();
      remaining += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done });
      if (remaining.length > 1024 * 1024 && !remaining.includes("\n")) {
        throw new OpenAICompatibleError("INVALID_RESPONSE", "SSE line exceeds 1 MiB");
      }
      let at = remaining.indexOf("\n");
      while (at >= 0) {
        const line = remaining.slice(0, at).trimEnd();
        remaining = remaining.slice(at + 1);
        if (line.length > 1024 * 1024) {
          throw new OpenAICompatibleError("INVALID_RESPONSE", "SSE line exceeds 1 MiB");
        }
        yield line;
        at = remaining.indexOf("\n");
      }
      if (chunk.done) {
        if (remaining.trim()) yield remaining.trim();
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
type ToolDelta = { id?: string; name?: string; arguments: string };
function parsePacket(data: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(data); } catch {
    throw new OpenAICompatibleError("INVALID_RESPONSE", "Provider returned invalid SSE JSON");
  }
  if (!record(value)) throw new OpenAICompatibleError("INVALID_RESPONSE", "SSE payload must be an object");
  if (record(value.error)) throw new OpenAICompatibleError("PROVIDER_ERROR",
    String(value.error.message ?? "Provider rejected request").slice(0, 300));
  return value;
}
/**
 * Implements /v1/chat/completions on explicitly configured compatible servers.
 * Compatibility is per endpoint and feature, never assumed from a hostname.
 * Does not execute tool calls or install services/models.
 */
export function openAICompatiblePlugin(config: OpenAICompatiblePluginConfig): ModelPlugin {
  const base = validUrl(config.baseUrl);
  const endpoint = new URL("chat/completions", base.href.endsWith("/") ? base.href : base.href + "/");
  const client = config.fetch ?? fetch;
  return {
    id: "@arcanai/plugin-openai-compatible",
    async *stream(request, context): AsyncIterable<PluginStreamEvent> {
      const body = bodyFor(request);
      if (context.signal.aborted) throw new OpenAICompatibleError("CANCELLED", "Execution cancelled");
      const response = await client(endpoint, {
        method: "POST", signal: context.signal,
        headers: {
          "Content-Type": "application/json",
          ...(config.apiKey ? { Authorization: "Bearer " + config.apiKey } : {}),
          ...config.headers,
        },
        body: JSON.stringify(body)
      });
      context.log("debug", "provider responded", { httpStatus: response.status });
      if (!response.ok) throw new OpenAICompatibleError("HTTP_" + response.status,
        "OpenAI-compatible provider returned HTTP " + response.status);
      if (!response.body) throw new OpenAICompatibleError("INVALID_RESPONSE", "Missing streaming response body");
      let done = false, finish: string | undefined;
      const tools = new Map<number, ToolDelta>();
      let usage: { inputTokens?: number; outputTokens?: number } = {};
      for await (const line of sseLines(response.body)) {
        if (context.signal.aborted) return;
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") { done = true; break; }
        const packet = parsePacket(data);
        if (!Array.isArray(packet.choices)) {
          // Usage-only final chunk is permitted.
          if (record(packet.usage)) {
            const u = packet.usage;
            if (Number.isSafeInteger(u.prompt_tokens) && (u.prompt_tokens as number) >= 0)
              usage.inputTokens = u.prompt_tokens as number;
            if (Number.isSafeInteger(u.completion_tokens) && (u.completion_tokens as number) >= 0)
              usage.outputTokens = u.completion_tokens as number;
            continue;
          }
          throw new OpenAICompatibleError("INVALID_RESPONSE", "Missing choices array");
        }
        if (packet.choices.length > 1) {
          throw new OpenAICompatibleError("UNSUPPORTED_CAPABILITY", "Multiple concurrent choices are unsupported");
        }
        const choice = packet.choices[0];
        if (record(choice)) {
          if (typeof choice.finish_reason === "string") finish = choice.finish_reason;
          if (record(choice.delta)) {
            const delta = choice.delta;
            if (typeof delta.content === "string" && delta.content)
              yield { type: "text-delta", text: delta.content };
            if (Array.isArray(delta.tool_calls)) {
              for (const entry of delta.tool_calls) {
                if (!record(entry) || !Number.isSafeInteger(entry.index) ||
                    (entry.index as number) < 0 || (entry.index as number) > 128) {
                  throw new OpenAICompatibleError("INVALID_RESPONSE", "Invalid tool-call delta index");
                }
                const key = entry.index as number;
                const part = tools.get(key) ?? { arguments: "" };
                if (typeof entry.id === "string") part.id = entry.id;
                if (record(entry.function)) {
                  if (typeof entry.function.name === "string") part.name = entry.function.name;
                  if (typeof entry.function.arguments === "string") {
                    part.arguments += entry.function.arguments;
                    if (part.arguments.length > 65536)
                      throw new OpenAICompatibleError("INVALID_RESPONSE", "Tool argument stream exceeds bound");
                  }
                }
                tools.set(key, part);
              }
            }
          }
        }
        if (record(packet.usage)) {
          const u = packet.usage;
          if (Number.isSafeInteger(u.prompt_tokens) && (u.prompt_tokens as number) >= 0)
            usage.inputTokens = u.prompt_tokens as number;
          if (Number.isSafeInteger(u.completion_tokens) && (u.completion_tokens as number) >= 0)
            usage.outputTokens = u.completion_tokens as number;
        }
      }
      if (!done) throw new OpenAICompatibleError("STREAM_INCOMPLETE",
        "Provider disconnected without terminal [DONE] event");
      for (const [index, entry] of [...tools].sort(([a], [b]) => a - b)) {
        if (!entry.id || !entry.name)
          throw new OpenAICompatibleError("INVALID_RESPONSE", "Incomplete tool call #" + index);
        let args: unknown;
        try { args = JSON.parse(entry.arguments); } catch {
          throw new OpenAICompatibleError("INVALID_RESPONSE", "Malformed tool-call arguments");
        }
        if (!record(args)) throw new OpenAICompatibleError("INVALID_RESPONSE",
          "Tool-call arguments must be an object");
        const call: ToolCall = { id: entry.id, name: entry.name, arguments: args as JsonRecord };
        yield { type: "tool-call", toolCall: call };
      }
      yield { type: "completed", finishReason: finish, usage };
    }
  };
}
