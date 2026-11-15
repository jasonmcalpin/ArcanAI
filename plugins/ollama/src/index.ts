import type { JsonRecord, ModelPlugin, PluginExecutionRequest, PluginStreamEvent } from "arcanai";

export interface OllamaPluginConfig {
  endpoint: string;
  headers?: Record<string, string>;
  /** Injected for tests; defaults to global fetch. */
  fetch?: typeof fetch;
}

export class OllamaPluginError extends Error {
  constructor(public readonly code: string, message: string, public readonly httpStatus?: number) {
    super(message);
    this.name = "OllamaPluginError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function makeBody(request: PluginExecutionRequest): Record<string, unknown> {
  const options: JsonRecord = {};
  const root: Record<string, unknown> = {};
  const reserved = new Set(["model", "messages", "stream", "options"]);
  const topLevel = new Set(["format", "think", "keep_alive", "tools"]);

  for (const [key, value] of Object.entries(request.providerOptions)) {
    if (reserved.has(key)) throw new OllamaPluginError("INVALID_OPTIONS", `providerOptions.${key} is reserved`);
    if (topLevel.has(key)) root[key] = value;
    else options[key] = value;
  }
  const mappings: Array<[keyof typeof request.options, string]> = [
    ["temperature", "temperature"], ["topP", "top_p"], ["maxTokens", "num_predict"]
  ];
  for (const [common, native] of mappings) {
    const value = request.options[common];
    if (value === undefined) continue;
    if (Object.hasOwn(options, native)) {
      throw new OllamaPluginError("OPTION_CONFLICT", `${common} conflicts with providerOptions.${native}`);
    }
    options[native] = value;
  }

  const messages = request.messages.map((message, index) => {
    if (message.role === "developer") {
      throw new OllamaPluginError("UNSUPPORTED_MESSAGE_ROLE", "Ollama does not support developer-role messages");
    }
    if (message.toolCallId !== undefined && !message.toolName) {
      throw new OllamaPluginError("UNSUPPORTED_MESSAGE_FIELD", `messages[${index}].toolCallId requires toolName`);
    }
    const content = typeof message.content === "string" ? message.content : (() => {
      const parts = message.content;
      if (parts.some(part => part.type !== "text")) {
        throw new OllamaPluginError("UNSUPPORTED_CONTENT", "Ollama adapter has not implemented image transport");
      }
      return parts.map(part => part.type === "text" ? part.text : "").join("");
    })();
    if (message.toolCalls?.length && message.role !== "assistant")
      throw new OllamaPluginError("INVALID_TOOL_HISTORY", "Only assistant messages may carry tool calls");
    if (message.toolName && message.role !== "tool")
      throw new OllamaPluginError("INVALID_TOOL_HISTORY", "Only tool messages may carry toolName");
    return {
      role: message.role,
      content,
      ...(message.toolCalls?.length ? { tool_calls: message.toolCalls.map(call => ({
        function: { name: call.name, arguments: call.arguments }
      })) } : {}),
      ...(message.toolName ? { tool_name: message.toolName } : {})
    };
  });
  return { model: request.model, messages, stream: true, ...root, options };
}

/** Decode newline-delimited JSON without assuming UTF-8 or JSON lines align with TCP chunks. */
async function* lines(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const maxLineLength = 1024 * 1024;
  try {
    while (true) {
      const next = await reader.read();
      buffer += next.done ? decoder.decode() : decoder.decode(next.value, { stream: true });
      if (buffer.length > maxLineLength && !buffer.includes("\n")) {
        throw new OllamaPluginError("INVALID_RESPONSE", "Ollama response line exceeded limit");
      }
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        if (line.length > maxLineLength) throw new OllamaPluginError("INVALID_RESPONSE", "Ollama response line exceeded limit");
        buffer = buffer.slice(newline + 1);
        if (line) yield line;
        newline = buffer.indexOf("\n");
      }
      if (next.done) {
        if (buffer.trim()) yield buffer.trim();
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseLine(text: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(text); } catch {
    throw new OllamaPluginError("INVALID_RESPONSE", "Ollama returned invalid JSON");
  }
  if (!isRecord(value)) throw new OllamaPluginError("INVALID_RESPONSE", "Ollama returned a non-object response");
  return value;
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function toolCalls(value: unknown, nextId: () => string): PluginStreamEvent[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new OllamaPluginError("INVALID_RESPONSE", "Ollama tool_calls must be an array");
  return value.map(item => {
    if (!isRecord(item) || !isRecord(item.function) || typeof item.function.name !== "string" || !isRecord(item.function.arguments)) {
      throw new OllamaPluginError("INVALID_RESPONSE", "Ollama returned an invalid tool call");
    }
    const args = item.function.arguments as JsonRecord;
    return {
      type: "tool-call" as const,
      toolCall: { id: nextId(), name: item.function.name, arguments: args }
    };
  });
}

/**
 * Ollama /api/chat adapter. Provider options are interpreted here, never in core.
 * This package intentionally does not install or manage Ollama or model weights.
 */
export function ollamaPlugin(config: OllamaPluginConfig): ModelPlugin {
  const url = new URL(config.endpoint.endsWith("/") ? config.endpoint : config.endpoint + "/");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new TypeError("Ollama endpoint must be an http(s) URL without embedded credentials");
  }
  const path = new URL("api/chat", url).toString();
  const client = config.fetch ?? fetch;

  return {
    id: "@arcanai/plugin-ollama",
    async *stream(request, context): AsyncIterable<PluginStreamEvent> {
      const body = makeBody(request);
      context.log("debug", "request prepared", { model: request.model, operation: "chat" });
      const response = await client(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...config.headers },
        signal: context.signal,
        body: JSON.stringify(body)
      });
      context.log("debug", "provider responded", { httpStatus: response.status });
      if (!response.ok) {
        throw new OllamaPluginError(`HTTP_${response.status}`, `Ollama returned HTTP ${response.status}`, response.status);
      }
      if (!response.body) throw new OllamaPluginError("INVALID_RESPONSE", "Ollama returned no response body");

      let id = 0;
      let completed = false;
      for await (const line of lines(response.body)) {
        if (context.signal.aborted) return;
        const packet = parseLine(line);
        if (typeof packet.error === "string") throw new OllamaPluginError("PROVIDER_ERROR", "Ollama: " + packet.error.slice(0, 300));
        const message = packet.message;
        if (message !== undefined && !isRecord(message)) throw new OllamaPluginError("INVALID_RESPONSE", "Ollama message must be an object");
        if (isRecord(message)) {
          if (typeof message.content === "string" && message.content) yield { type: "text-delta", text: message.content };
          if (typeof message.thinking === "string" && message.thinking) yield { type: "reasoning-delta", text: message.thinking };
          for (const call of toolCalls(message.tool_calls, () => `ollama-call-${++id}`)) yield call;
        }
        if (packet.done === true) {
          completed = true;
          const usage = {
            inputTokens: tokenCount(packet.prompt_eval_count),
            outputTokens: tokenCount(packet.eval_count)
          };
          const providerMetadata: JsonRecord = {};
          for (const key of ["total_duration", "load_duration", "prompt_eval_duration", "eval_duration"]) {
            const value = tokenCount(packet[key]);
            if (value !== undefined) providerMetadata[key] = value;
          }
          context.log("debug", "provider completed", { outputTokens: usage.outputTokens ?? 0 });
          yield {
            type: "completed",
            finishReason: typeof packet.done_reason === "string" ? packet.done_reason : undefined,
            usage,
            providerMetadata
          };
          break;
        }
      }
      if (!completed) throw new OllamaPluginError("STREAM_INCOMPLETE", "Ollama closed its stream without a done event");
    }
  };
}
