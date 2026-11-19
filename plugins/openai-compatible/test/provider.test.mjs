import test from "node:test";
import assert from "node:assert/strict";
import { createArcanAI, parseModelCard } from "../../../dist/src/index.js";
import { openAICompatiblePlugin } from "../dist/index.js";

const card = parseModelCard({ schemaVersion: "1.0", id: "compatible",
  execution: { plugin: "@arcanai/plugin-openai-compatible", instance: "server",
    model: "local-instruct", options: { maxTokens: 32 } } });
function stream(chunks) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    }
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
}
function fixture(fetcher) {
  const sdk = createArcanAI("off");
  sdk.register({ id: "server",
    capabilities: { schemaVersion: "1", modalities: ["text"], streaming: true, toolCalls: true },
    plugin: openAICompatiblePlugin({ baseUrl: "http://127.0.0.1:12345/v1/", fetch: fetcher }) });
  return sdk;
}
test("streams fragmented SSE text and normalized usage without shell or tool execution", async () => {
  const seen = [];
  const sdk = fixture(async (url, init) => {
    assert.equal(new URL(url).pathname, "/v1/chat/completions");
    assert.equal(init.method, "POST");
    seen.push(JSON.parse(init.body));
    return stream([
      'data: {"choices":[{"delta":{"content":"hel"}}]}\n',
      '\n',
      'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}\n',
      'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n',
      'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n',
      "data: [DONE]\n\n"
    ]);
  });
  const result = await sdk.generate({ card, messages: [{ role: "user", content: "hello" }],
    requiredCapabilities: ["text", "streaming"] });
  assert.equal(result.status, "success");
  assert.equal(result.text, "hello");
  assert.deepEqual(result.usage, { inputTokens: 5, outputTokens: 2 });
  assert.equal(seen[0].model, "local-instruct");
  assert.equal(seen[0].max_tokens, 32);
});
test("assembles fragmented native tool calls into structured host-owned output", async () => {
  const sdk = fixture(async () => stream([
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call1","function":{"name":"read_file","arguments":"{\\"path\\":"}}]}}]}\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"README.md\\"}"}}]},"finish_reason":"tool_calls"}]}\n',
    'data: [DONE]\n'
  ]));
  const result = await sdk.generate({ card, messages: [], requiredCapabilities: ["toolCalls"] });
  assert.equal(result.status, "success");
  assert.deepEqual(result.toolCalls, [{ id: "call1", name: "read_file", arguments: { path: "README.md" } }]);
  assert.equal(result.finishReason, "tool_calls");
});
test("rejects unsupported features, HTTP errors, and incomplete streams", async () => {
  let invoked = false;
  const sdk = fixture(async () => { invoked = true; return stream(["data: [DONE]\n"]); });
  const unsupported = await sdk.generate({ card, messages: [{
    role: "user", content: [{ type: "image", source: { type: "url", url: "https://example.com/img.png" } }]
  }] });
  assert.equal(unsupported.status, "error");
  assert.equal(unsupported.error?.code, "UNSUPPORTED_CONTENT");
  assert.equal(invoked, false);
  const badOption = await sdk.generate({ card, messages: [], providerOptions: { inject: 1 } });
  assert.equal(badOption.error?.code, "UNSUPPORTED_OPTION");
  assert.equal(invoked, false);
  const refused = fixture(async () => new Response(null, { status: 503 }));
  const rejected = await refused.generate({ card, messages: [] });
  assert.equal(rejected.error?.code, "HTTP_503");
  const incomplete = fixture(async () => stream(["data: {\"choices\":[]}\n"]));
  assert.equal((await incomplete.generate({ card, messages: [] })).error?.code, "STREAM_INCOMPLETE");
});
test("abort signal reaches HTTP transport and cancellation never becomes success", async () => {
  const controller = new AbortController();
  const sdk = fixture(async (_url, init) => {
    controller.abort();
    assert.equal(init.signal.aborted, true);
    throw Object.assign(new Error("aborted"), { name: "AbortError" });
  });
  const result = await sdk.generate({ card, messages: [], signal: controller.signal });
  assert.equal(result.status, "cancelled");
});
