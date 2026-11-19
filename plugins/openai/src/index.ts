import type { JsonRecord, Message, ModelPlugin, PluginExecutionRequest, PluginStreamEvent } from "arcanai";

export interface OpenAIPluginConfig {
  apiKey: string;
  /** Default uses the public Responses API. Only trusted host config may override. */
  endpoint?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
}
export class OpenAIPluginError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "OpenAIPluginError";
  }
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
function endpointOf(config: OpenAIPluginConfig): string {
  if (typeof config.apiKey !== "string" || !config.apiKey.trim()) {
    throw new OpenAIPluginError("MISSING_CREDENTIAL", "OpenAI API key must be host-configured");
  }
  const url = new URL(config.endpoint ?? "https://api.openai.com/v1/responses");
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new OpenAIPluginError("INVALID_ENDPOINT", "OpenAI endpoint must be trusted HTTPS without embedded credentials");
  }
  return url.href;
}
function plain(message: Message): string {
  if (typeof message.content === "string") return message.content;
  if (message.content.some(part => part.type !== "text")) {
    throw new OpenAIPluginError("UNSUPPORTED_CONTENT", "OpenAI Responses adapter currently supports text input only");
  }
  return message.content.map(part => part.type === "text" ? part.text : "").join("");
}
function inputOf(messages: Message[]): unknown[] {
  const items: unknown[] = [];
  for (const message of messages) {
    if (message.role === "tool") {
      if (!message.toolCallId) throw new OpenAIPluginError("INVALID_TOOL_HISTORY",
        "Function results require the original call ID");
      items.push({ type: "function_call_output", call_id: message.toolCallId, output: plain(message) });
      continue;
    }
    if (message.toolCallId || message.toolName) throw new OpenAIPluginError(
      "INVALID_TOOL_HISTORY", "Only tool-result messages carry call IDs");
    if (message.toolCalls?.length && message.role !== "assistant") {
      throw new OpenAIPluginError("INVALID_TOOL_HISTORY", "Only assistant messages may issue calls");
    }
    items.push({ role: message.role, content: plain(message) });
    for (const call of message.toolCalls ?? []) {
      items.push({ type: "function_call", call_id: call.id, name: call.name,
        arguments: JSON.stringify(call.arguments) });
    }
  }
  return items;
}
function requestBody(req: PluginExecutionRequest): Record<string, unknown> {
  const allowed = new Set(["tools", "tool_choice", "reasoning", "text", "parallel_tool_calls"]);
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(req.providerOptions)) {
    if (!allowed.has(key)) throw new OpenAIPluginError("UNSUPPORTED_OPTION", "Unsupported Responses option: " + key);
    extra[key] = value;
  }
  if (extra.tools !== undefined && !Array.isArray(extra.tools)) {
    throw new OpenAIPluginError("INVALID_OPTIONS", "Responses tools must be an array");
  }
  const max = req.options.maxTokens;
  if (max !== undefined && max < 16) {
    throw new OpenAIPluginError("INVALID_OPTIONS", "Responses max_output_tokens must be >=16");
  }
  return {
    model: req.model, input: inputOf(req.messages), stream: true, store: false,
    ...(max === undefined ? {} : { max_output_tokens: max }),
    ...(req.options.temperature === undefined ? {} : { temperature: req.options.temperature }),
    ...(req.options.topP === undefined ? {} : { top_p: req.options.topP }),
    ...extra,
  };
}
async function* dataLines(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader(), decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done });
      if (buffer.length > 1024 * 1024 && !buffer.includes("\n"))
        throw new OpenAIPluginError("INVALID_RESPONSE", "Responses event line exceeds bound");
      let pos = buffer.indexOf("\n");
      while (pos >= 0) {
        const line = buffer.slice(0, pos).trim();
        buffer = buffer.slice(pos + 1);
        if (line.length > 1024 * 1024)
          throw new OpenAIPluginError("INVALID_RESPONSE", "Responses event line exceeds bound");
        if (line.startsWith("data:")) yield line.slice(5).trim();
        pos = buffer.indexOf("\n");
      }
      if (chunk.done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
type PendingCall = { id: string; name: string; args: string };
function eventObject(raw: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(raw); } catch {
    throw new OpenAIPluginError("INVALID_RESPONSE", "Invalid Responses SSE JSON");
  }
  if (!object(value) || typeof value.type !== "string")
    throw new OpenAIPluginError("INVALID_RESPONSE", "Responses SSE event has no type");
  return value;
}
export function openAIResponsesPlugin(config: OpenAIPluginConfig): ModelPlugin {
  const url = endpointOf(config);
  const client = config.fetch ?? fetch;
  return {
    id: "@arcanai/plugin-openai",
    async *stream(req, ctx): AsyncIterable<PluginStreamEvent> {
      const body = requestBody(req);
      const res = await client(url, {
        method: "POST", signal: ctx.signal,
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + config.apiKey,
          ...config.headers },
        body: JSON.stringify(body),
      });
      ctx.log("debug", "provider response", { httpStatus: res.status });
      if (!res.ok) throw new OpenAIPluginError("HTTP_" + res.status,
        "OpenAI Responses returned HTTP " + res.status);
      if (!res.body) throw new OpenAIPluginError("INVALID_RESPONSE", "Responses returned no streaming body");
      const calls = new Map<string, PendingCall>();
      let completed = false, finishReason = "stop";
      let usage: { inputTokens?: number; outputTokens?: number } = {};
      for await (const raw of dataLines(res.body)) {
        if (ctx.signal.aborted) return;
        if (!raw || raw === "[DONE]") continue;
        const event = eventObject(raw);
        if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
          yield { type: "text-delta", text: event.delta };
        } else if (event.type === "response.output_item.added" && object(event.item) &&
          event.item.type === "function_call") {
          const item = event.item;
          if (typeof event.item_id !== "string" && typeof item.id !== "string")
            throw new OpenAIPluginError("INVALID_RESPONSE", "Function call missing item identity");
          const key = String(event.item_id ?? item.id);
          if (typeof item.call_id !== "string" || typeof item.name !== "string")
            throw new OpenAIPluginError("INVALID_RESPONSE", "Function call missing ID or name");
          calls.set(key, { id: item.call_id, name: item.name, args: "" });
        } else if (event.type === "response.function_call_arguments.delta") {
          if (typeof event.item_id !== "string" || typeof event.delta !== "string" ||
            !calls.has(event.item_id)) {
            throw new OpenAIPluginError("INVALID_RESPONSE", "Unmatched function argument fragment");
          }
          const call = calls.get(event.item_id)!;
          call.args += event.delta;
          if (call.args.length > 65536) throw new OpenAIPluginError("INVALID_RESPONSE",
            "Function-call arguments exceed bound");
        } else if (event.type === "response.function_call_arguments.done") {
          if (typeof event.item_id !== "string" || typeof event.arguments !== "string" ||
            !calls.has(event.item_id)) throw new OpenAIPluginError("INVALID_RESPONSE",
            "Unmatched completed function arguments");
          calls.get(event.item_id)!.args = event.arguments;
        } else if (event.type === "response.completed") {
          completed = true;
          if (object(event.response)) {
            const response = event.response;
            if (typeof response.status === "string" && response.status !== "completed") {
              throw new OpenAIPluginError("PROVIDER_ERROR", "Responses did not complete successfully");
            }
            if (object(response.usage)) {
              const u = response.usage;
              if (Number.isSafeInteger(u.input_tokens)) usage.inputTokens = u.input_tokens as number;
              if (Number.isSafeInteger(u.output_tokens)) usage.outputTokens = u.output_tokens as number;
            }
          }
        } else if (event.type === "response.failed" || event.type === "response.incomplete") {
          throw new OpenAIPluginError("PROVIDER_ERROR", "OpenAI Responses ended without successful completion");
        }
      }
      if (!completed) throw new OpenAIPluginError("STREAM_INCOMPLETE",
        "Responses disconnected without a response.completed event");
      for (const call of calls.values()) {
        let parsed: unknown;
        try { parsed = JSON.parse(call.args); } catch {
          throw new OpenAIPluginError("INVALID_RESPONSE", "Invalid JSON function arguments");
        }
        if (!object(parsed)) throw new OpenAIPluginError("INVALID_RESPONSE",
          "Function arguments must be an object");
        yield { type: "tool-call", toolCall: { id: call.id, name: call.name,
          arguments: parsed as JsonRecord } };
      }
      if (calls.size) finishReason = "tool_calls";
      yield { type: "completed", finishReason, usage };
    }
  };
}
