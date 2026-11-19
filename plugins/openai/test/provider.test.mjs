import test from "node:test";
import assert from "node:assert/strict";
import { createArcanAI, parseModelCard } from "../../../dist/src/index.js";
import { openAIResponsesPlugin } from "../dist/index.js";

const card = parseModelCard({ schemaVersion: "1.0", id: "responses",
  execution: { plugin: "@arcanai/plugin-openai", instance: "provider",
    model: "test-api-model", options: { maxTokens: 32 } } });
function stream(chunks) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    }
  }), { headers: { "content-type": "text/event-stream" } });
}
function sdk(fetcher) {
  const a = createArcanAI("off");
  a.register({ id: "provider", capabilities: {
    schemaVersion: "1", modalities: ["text"], streaming: true, toolCalls: true,
  }, plugin: openAIResponsesPlugin({ apiKey: "test-only-key", fetch: fetcher }) });
  return a;
}
test("OpenAI Responses request is streamed and normalized with no implicit tool execution", async () => {
  const runtime = sdk(async (_url, init) => {
    assert.equal(new URL(_url).pathname, "/v1/responses");
    assert.match(init.headers.Authorization, /^Bearer /);
    const request = JSON.parse(init.body);
    assert.equal(request.store, false);
    assert.equal(request.max_output_tokens, 32);
    assert.equal(request.input[0].role, "user");
    return stream([
      'data: {"type":"response.output_text.delta","delta":"hello "}\n\n',
      'data: {"type":"response.output_text.delta","delta":"world"}\n\n',
      'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":8,"output_tokens":2}}}\n\n'
    ]);
  });
  const result = await runtime.generate({ card, messages: [{ role: "user", content: "hello" }],
    requiredCapabilities: ["text", "streaming"] });
  assert.equal(result.status, "success");
  assert.equal(result.text, "hello world");
  assert.deepEqual(result.usage, { inputTokens: 8, outputTokens: 2 });
});
test("OpenAI Responses assembles native function-call events and preserves identity", async () => {
  const runtime = sdk(async () => stream([
    'data: {"type":"response.output_item.added","item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"read_file"}}\n',
    'data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","delta":"{\\"path\\":"}\n',
    'data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","delta":"\\"a.txt\\"}"}\n',
    'data: {"type":"response.function_call_arguments.done","item_id":"fc_1","arguments":"{\\"path\\":\\"a.txt\\"}"}\n',
    'data: {"type":"response.completed","response":{"status":"completed"}}\n'
  ]));
  const result = await runtime.generate({ card, messages: [] });
  assert.equal(result.status, "success");
  assert.equal(result.finishReason, "tool_calls");
  assert.deepEqual(result.toolCalls, [{ id: "call_1", name: "read_file", arguments: { path: "a.txt" } }]);
});
test("OpenAI Responses rejects unsupported modalities and incomplete events", async () => {
  let invoked = false;
  const runtime = sdk(async () => { invoked = true; return stream([]); });
  const bad = await runtime.generate({ card, messages: [{ role: "user", content: [
    { type: "image", source: { type: "url", url: "https://example.com/i.png" } }
  ] }] });
  assert.equal(bad.error?.code, "UNSUPPORTED_CONTENT");
  assert.equal(invoked, false);
  const incomplete = await runtime.generate({ card, messages: [] });
  assert.equal(incomplete.error?.code, "STREAM_INCOMPLETE");
});
test("OpenAI Responses rejects provider errors and respects cancellation", async () => {
  const unavailable = sdk(async () => new Response(null, { status: 429 }));
  assert.equal((await unavailable.generate({ card, messages: [] })).error?.code, "HTTP_429");
  const aborted = new AbortController();
  const cancelled = sdk(async (_url, init) => {
    aborted.abort();
    assert.equal(init.signal.aborted, true);
    throw new Error("cancelled transport");
  });
  assert.equal((await cancelled.generate({ card, messages: [], signal: aborted.signal })).status, "cancelled");
});
