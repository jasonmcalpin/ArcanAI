import type { JsonRecord, Message, ModelPlugin, PluginExecutionRequest, PluginStreamEvent } from "arcanai";

export interface AnthropicPluginConfig {
  apiKey: string;
  endpoint?: string;
  version?: string;
  fetch?: typeof fetch;
}
export class AnthropicPluginError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "AnthropicPluginError"; }
}
const object = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x);
function endpointOf(config: AnthropicPluginConfig): string {
  if (!config.apiKey?.trim()) throw new AnthropicPluginError("MISSING_CREDENTIAL",
    "Anthropic API key must be provided by the trusted host");
  const url = new URL(config.endpoint ?? "https://api.anthropic.com/v1/messages");
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new AnthropicPluginError("INVALID_ENDPOINT", "Anthropic endpoint must use trusted HTTPS");
  return url.href;
}
function textOf(message: Message): string {
  if (typeof message.content === "string") return message.content;
  if (message.content.some(part => part.type !== "text"))
    throw new AnthropicPluginError("UNSUPPORTED_CONTENT", "Anthropic adapter currently supports text only");
  return message.content.map(part => part.type === "text" ? part.text : "").join("");
}
function requestBody(request: PluginExecutionRequest) {
  const allowed = new Set(["tools", "tool_choice", "thinking", "stop_sequences"]);
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(request.providerOptions)) {
    if (!allowed.has(key)) throw new AnthropicPluginError("UNSUPPORTED_OPTION",
      "Unsupported Anthropic option: " + key);
    extra[key] = value;
  }
  if (extra.tools !== undefined && !Array.isArray(extra.tools))
    throw new AnthropicPluginError("INVALID_OPTIONS", "tools must be an array");
  if (request.options.maxTokens === undefined)
    throw new AnthropicPluginError("INVALID_OPTIONS", "Anthropic max_tokens is required");
  const system: string[] = [], messages: unknown[] = [];
  for (const message of request.messages) {
    if (message.role === "system") {
      system.push(textOf(message)); continue;
    }
    if (message.role === "developer") throw new AnthropicPluginError("UNSUPPORTED_MESSAGE_ROLE",
      "Anthropic Messages has no separate developer-role semantics");
    if (message.role === "tool") {
      if (!message.toolCallId) throw new AnthropicPluginError("INVALID_TOOL_HISTORY",
        "Tool results must include call ID");
      messages.push({ role: "user", content: [{
        type: "tool_result", tool_use_id: message.toolCallId, content: textOf(message)
      }] });
      continue;
    }
    if (message.toolName || message.toolCallId)
      throw new AnthropicPluginError("INVALID_TOOL_HISTORY", "Tool result IDs require tool role");
    if (message.toolCalls?.length && message.role !== "assistant")
      throw new AnthropicPluginError("INVALID_TOOL_HISTORY", "Only assistant messages carry tool calls");
    if (message.toolCalls?.length) {
      messages.push({ role: "assistant", content: [
        { type: "text", text: textOf(message) },
        ...message.toolCalls.map(call => ({ type: "tool_use", id: call.id, name: call.name, input: call.arguments }))
      ] });
    } else messages.push({ role: message.role, content: textOf(message) });
  }
  return {
    model: request.model, stream: true, max_tokens: request.options.maxTokens,
    ...(system.length ? { system: system.join("\n\n") } : {}),
    messages,
    ...(request.options.temperature === undefined ? {} : { temperature: request.options.temperature }),
    ...(request.options.topP === undefined ? {} : { top_p: request.options.topP }),
    ...extra,
  };
}
async function* packets(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader(), decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done });
      if (buffer.length > 1024 * 1024 && !buffer.includes("\n"))
        throw new AnthropicPluginError("INVALID_RESPONSE", "SSE line exceeds 1 MiB");
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.length > 1024 * 1024)
          throw new AnthropicPluginError("INVALID_RESPONSE", "SSE line exceeds 1 MiB");
        if (line.startsWith("data:")) {
          let parsed: unknown;
          try { parsed = JSON.parse(line.slice(5).trim()); }
          catch { throw new AnthropicPluginError("INVALID_RESPONSE", "Invalid Anthropic SSE JSON"); }
          if (!object(parsed) || typeof parsed.type !== "string")
            throw new AnthropicPluginError("INVALID_RESPONSE", "Invalid Anthropic SSE event");
          yield parsed;
        }
        newline = buffer.indexOf("\n");
      }
      if (chunk.done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
type PendingTool = { id: string; name: string; args: string };
export function anthropicMessagesPlugin(config: AnthropicPluginConfig): ModelPlugin {
  const endpoint = endpointOf(config);
  const client = config.fetch ?? fetch;
  return {
    id: "@arcanai/plugin-anthropic",
    async *stream(req, ctx): AsyncIterable<PluginStreamEvent> {
      const body = requestBody(req);
      const response = await client(endpoint, {
        method: "POST", signal: ctx.signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": config.version ?? "2026-10-21"
        },
        body: JSON.stringify(body)
      });
      ctx.log("debug", "provider responded", { httpStatus: response.status });
      if (!response.ok) throw new AnthropicPluginError("HTTP_" + response.status,
        "Anthropic Messages returned HTTP " + response.status);
      if (!response.body) throw new AnthropicPluginError("INVALID_RESPONSE", "Messages returned no stream body");
      const pending = new Map<number, PendingTool>();
      let done = false, finish = "end_turn";
      const usage: { inputTokens?: number; outputTokens?: number } = {};
      for await (const event of packets(response.body)) {
        if (ctx.signal.aborted) return;
        if (event.type === "error") throw new AnthropicPluginError("PROVIDER_ERROR",
          object(event.error) ? String(event.error.message ?? "Anthropic stream error").slice(0, 300)
            : "Anthropic stream error");
        if (event.type === "message_start" && object(event.message) && object(event.message.usage)) {
          const u = event.message.usage;
          if (Number.isSafeInteger(u.input_tokens)) usage.inputTokens = u.input_tokens as number;
        } else if (event.type === "content_block_start") {
          if (!Number.isSafeInteger(event.index) || (event.index as number) < 0 ||
            (event.index as number) > 128 || !object(event.content_block))
            throw new AnthropicPluginError("INVALID_RESPONSE", "Malformed content block");
          const block = event.content_block;
          if (block.type === "tool_use") {
            if (typeof block.id !== "string" || typeof block.name !== "string")
              throw new AnthropicPluginError("INVALID_RESPONSE", "Incomplete tool use block");
            pending.set(event.index as number, { id: block.id, name: block.name, args: "" });
          }
        } else if (event.type === "content_block_delta" && object(event.delta)) {
          const delta = event.delta;
          if (delta.type === "text_delta" && typeof delta.text === "string")
            yield { type: "text-delta", text: delta.text };
          else if (delta.type === "thinking_delta" && typeof delta.thinking === "string")
            yield { type: "reasoning-delta", text: delta.thinking };
          else if (delta.type === "input_json_delta") {
            if (!Number.isSafeInteger(event.index) || !pending.has(event.index as number) ||
              typeof delta.partial_json !== "string")
              throw new AnthropicPluginError("INVALID_RESPONSE", "Unmatched tool argument stream");
            const call = pending.get(event.index as number)!;
            call.args += delta.partial_json;
            if (call.args.length > 65536)
              throw new AnthropicPluginError("INVALID_RESPONSE", "Tool argument stream exceeds bound");
          }
        } else if (event.type === "message_delta") {
          if (object(event.delta) && typeof event.delta.stop_reason === "string")
            finish = event.delta.stop_reason;
          if (object(event.usage) && Number.isSafeInteger(event.usage.output_tokens))
            usage.outputTokens = event.usage.output_tokens as number;
        } else if (event.type === "message_stop") done = true;
      }
      if (!done) throw new AnthropicPluginError("STREAM_INCOMPLETE",
        "Anthropic stream disconnected without message_stop");
      for (const call of pending.values()) {
        let args: unknown;
        try { args = JSON.parse(call.args || "{}"); } catch {
          throw new AnthropicPluginError("INVALID_RESPONSE", "Malformed tool arguments");
        }
        if (!object(args)) throw new AnthropicPluginError("INVALID_RESPONSE",
          "Tool arguments must be an object");
        yield { type: "tool-call", toolCall: {
          id: call.id, name: call.name, arguments: args as JsonRecord
        } };
      }
      yield { type: "completed", finishReason: finish, usage };
    }
  };
}
