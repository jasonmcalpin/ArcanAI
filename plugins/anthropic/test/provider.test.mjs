import test from "node:test";
import assert from "node:assert/strict";
import { createArcanAI, parseModelCard } from "../../../dist/src/index.js";
import { anthropicMessagesPlugin } from "../dist/index.js";

const card = parseModelCard({ schemaVersion: "1.0", id: "claude",
  execution: { plugin: "@arcanai/plugin-anthropic", instance: "hosted",
    model: "test-anthropic-model", options: { maxTokens: 32 } } });
function stream(lines) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(new TextEncoder().encode(line));
      controller.close();
    }
  }), { headers: { "content-type": "text/event-stream" } });
}
function client(fetcher) {
  const sdk = createArcanAI("off");
  sdk.register({ id: "hosted", capabilities: {
    schemaVersion: "1", modalities: ["text"], streaming: true, toolCalls: true,
  }, plugin: anthropicMessagesPlugin({ apiKey: "fixture-key", fetch: fetcher }) });
  return sdk;
}
test("Anthropic Messages streams text, usage, and separates system from message roles", async () => {
  const sdk = client(async (url, init) => {
    assert.equal(new URL(url).pathname, "/v1/messages");
    assert.equal(init.headers["anthropic-version"], "2026-10-21");
    const body = JSON.parse(init.body);
    assert.equal(body.system, "Safety requirements");
    assert.equal(body.max_tokens, 32);
    assert.equal(body.messages[0].role, "user");
    return stream([
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":9}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello "}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"world"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n'
    ]);
  });
  const result = await sdk.generate({ card, messages: [
    { role: "system", content: "Safety requirements" },
    { role: "user", content: "Hello" }
  ] });
  assert.equal(result.status, "success");
  assert.equal(result.text, "hello world");
  assert.deepEqual(result.usage, { inputTokens: 9, outputTokens: 2 });
});
test("Anthropic tool_use input_json_delta produces structured host-owned tool call", async () => {
  const sdk = client(async () => stream([
    'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"read_file","input":{}}}\n',
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":"}}\n',
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"README.md\\"}"}}\n',
    'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":8}}\n',
    'data: {"type":"message_stop"}\n'
  ]));
  const result = await sdk.generate({ card, messages: [] });
  assert.equal(result.status, "success");
  assert.equal(result.finishReason, "tool_use");
  assert.deepEqual(result.toolCalls, [{
    id: "toolu_1", name: "read_file", arguments: { path: "README.md" }
  }]);
});
test("Anthropic explicitly rejects unsupported developer role, media and provider options", async () => {
  let called = false;
  const sdk = client(async () => { called = true; return stream([]); });
  for (const request of [
    { messages: [{ role: "developer", content: "Instruction" }] },
    { messages: [{ role: "user", content: [{ type: "image", source: {
      type: "url", url: "https://example.com/i.png" } }] }] },
    { messages: [], providerOptions: { unsupported: true } }
  ]) {
    const result = await sdk.generate({ card, ...request });
    assert.equal(result.status, "error");
  }
  assert.equal(called, false);
});
test("Anthropic protocol errors, missing terminal and cancellation fail closed", async () => {
  const unavailable = client(async () => new Response(null, { status: 529 }));
  assert.equal((await unavailable.generate({ card, messages: [] })).error?.code, "HTTP_529");
  const incomplete = client(async () => stream([
    'data: {"type":"message_start","message":{}}\n'
  ]));
  assert.equal((await incomplete.generate({ card, messages: [] })).error?.code, "STREAM_INCOMPLETE");
  const controller = new AbortController();
  const cancelled = client(async (_url, init) => {
    controller.abort();
    assert.equal(init.signal.aborted, true);
    throw Error("transport abort");
  });
  assert.equal((await cancelled.generate({ card, messages: [], signal: controller.signal })).status,
    "cancelled");
});
