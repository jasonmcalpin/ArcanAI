import test from "node:test";
import assert from "node:assert/strict";
import { createArcanAI, parseModelCard } from "../../../dist/src/index.js";
import { ollamaPlugin } from "../dist/index.js";

const card = parseModelCard({
  schemaVersion: "1.0",
  id: "qwen",
  execution: {
    plugin: "@arcanai/plugin-ollama",
    instance: "mini",
    model: "qwen3:8b",
    options: { maxTokens: 64, temperature: 0.4 },
    providerOptions: { num_ctx: 4096 }
  }
});

function responseLines(...items) {
  const full = items.map(x => JSON.stringify(x)).join("\n") + "\n";
  const bytes = new TextEncoder().encode(full);
  const breakpoint = Math.min(bytes.length - 1, 11);
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, breakpoint));
      controller.enqueue(bytes.slice(breakpoint));
      controller.close();
    }
  }), { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
}

test("Ollama plugin sends expected native options and decodes split NDJSON", async () => {
  let sent;
  const plugin = ollamaPlugin({
    endpoint: "http://localhost:11434",
    fetch: async (url, options) => {
      sent = { url: String(url), method: options.method, payload: JSON.parse(options.body) };
      return responseLines(
        { message: { content: "hello ", thinking: "reasoning" }, done: false },
        { message: { content: "world" }, done: false },
        { done: true, done_reason: "stop", prompt_eval_count: 10, eval_count: 2, total_duration: 12345 }
      );
    }
  });
  const runtime = createArcanAI();
  runtime.register({ id: "mini", plugin });
  const result = await runtime.generate({ card, messages: [{ role: "user", content: "hi" }], timers: { heartbeatMs: 1000 } });
  assert.equal(sent.url, "http://localhost:11434/api/chat");
  assert.equal(sent.method, "POST");
  assert.equal(sent.payload.stream, true);
  assert.equal(sent.payload.model, "qwen3:8b");
  assert.deepEqual(sent.payload.messages, [{ role: "user", content: "hi" }]);
  assert.deepEqual(sent.payload.options, { num_ctx: 4096, num_predict: 64, temperature: 0.4 });
  assert.equal(result.status, "success");
  assert.equal(result.text, "hello world");
  assert.equal(result.reasoning, "reasoning");
  assert.equal(result.finishReason, "stop");
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 2 });
  assert.equal(result.providerMetadata.total_duration, 12345);
});

test("Ollama tool calls remain structured data for the host", async () => {
  const runtime = createArcanAI();
  runtime.register({ id: "mini", plugin: ollamaPlugin({
    endpoint: "http://localhost:11434",
    fetch: async () => responseLines(
      { done: false, message: { tool_calls: [{ function: { name: "lookup", arguments: { query: "x" } } }] } },
      { done: true, eval_count: 1 }
    )
  }) });
  const result = await runtime.generate({ card, messages: [] });
  assert.equal(result.status, "success");
  assert.deepEqual(result.toolCalls, [{ id: "ollama-call-1", name: "lookup", arguments: { query: "x" } }]);
});

test("provider HTTP errors are surfaced without automatic retry", async () => {
  let count = 0;
  const runtime = createArcanAI();
  runtime.register({ id: "mini", plugin: ollamaPlugin({
    endpoint: "http://localhost:11434",
    fetch: async () => { count++; return new Response("error", { status: 404 }); }
  }) });
  const result = await runtime.generate({ card, messages: [] });
  assert.equal(result.status, "error");
  assert.equal(result.error.code, "HTTP_404");
  assert.equal(count, 1);
});

test("Ollama validates conflicts and unsupported roles before dispatch", async () => {
  let count = 0;
  const runtime = createArcanAI();
  runtime.register({ id: "mini", plugin: ollamaPlugin({
    endpoint: "http://localhost:11434",
    fetch: async () => { count++; return responseLines({ done: true }); }
  }) });
  const badOptions = await runtime.generate({
    card, messages: [], providerOptions: { num_predict: 99 }
  });
  assert.equal(badOptions.error.code, "OPTION_CONFLICT");
  const unsupported = await runtime.generate({
    card, messages: [{ role: "developer", content: "instructions" }]
  });
  assert.equal(unsupported.error.code, "UNSUPPORTED_MESSAGE_ROLE");
  assert.equal(count, 0);
});

test("early provider disconnect is reported as failure", async () => {
  const runtime = createArcanAI();
  runtime.register({ id: "mini", plugin: ollamaPlugin({
    endpoint: "http://localhost:11434",
    fetch: async () => responseLines({ message: { content: "partial" }, done: false })
  }) });
  const result = await runtime.generate({ card, messages: [] });
  assert.equal(result.status, "error");
  assert.equal(result.error.code, "STREAM_INCOMPLETE");
});

test("endpoint configuration rejects embedded credentials", () => {
  assert.throws(() => ollamaPlugin({ endpoint: "http://user:secret@localhost:11434" }), /without embedded credentials/);
});

test("native Ollama continuation preserves assistant tool_calls and named tool receipts", async () => {
  let sent;
  const runtime = createArcanAI();
  runtime.register({ id: "mini", plugin: ollamaPlugin({
    endpoint: "http://localhost:11434",
    fetch: async (_url, options) => {
      sent = JSON.parse(options.body);
      return responseLines({ message: { content: "Relay healthy." }, done: true, eval_count: 6 });
    }
  }) });
  const result = await runtime.generate({ card, messages: [
    { role: "user", content: "Check relay" },
    { role: "assistant", content: "I'll inspect it.", toolCalls: [
      { id: "call-1", name: "workspace.read_text", arguments: { path: "relay-status.txt" } }
    ] },
    { role: "tool", content: '{"ok":true,"value":{"text":"healthy"}}',
      toolName: "workspace.read_text", toolCallId: "call-1" }
  ] });
  assert.equal(result.status, "success");
  assert.deepEqual(sent.messages[1], {
    role: "assistant", content: "I'll inspect it.",
    tool_calls: [{ function: { name: "workspace.read_text",
      arguments: { path: "relay-status.txt" } } }]
  });
  assert.deepEqual(sent.messages[2], {
    role: "tool", tool_name: "workspace.read_text",
    content: '{"ok":true,"value":{"text":"healthy"}}'
  });
});

test("non-assistant tool call history is rejected", async () => {
  const runtime = createArcanAI();
  runtime.register({ id: "mini", plugin: ollamaPlugin({
    endpoint: "http://localhost:11434",
    fetch: async () => responseLines({ done: true })
  }) });
  const result = await runtime.generate({ card, messages: [
    { role: "user", content: "tool", toolCalls: [
      { id: "bad", name: "shell", arguments: { command: "ls" } }
    ] }
  ] });
  assert.equal(result.status, "error");
  assert.match(result.error.message, /toolCalls must be nonempty structured assistant tool calls/);
});
