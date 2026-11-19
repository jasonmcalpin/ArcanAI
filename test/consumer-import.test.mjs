import test from "node:test";
import assert from "node:assert/strict";
import { createArcanAI, parseModelCard } from "arcanai";
import { transformersJsPlugin } from "arcanai/plugins/transformersjs";
import { ollamaPlugin } from "arcanai/plugins/ollama";
import { openAICompatiblePlugin } from "arcanai/plugins/openai-compatible";
import { openAIResponsesPlugin } from "arcanai/plugins/openai";
import { anthropicMessagesPlugin } from "arcanai/plugins/anthropic";

test("public package subpath imports resolve without consumer-specific paths", async () => {
  assert.equal(typeof ollamaPlugin, "function");
  const runtime = createArcanAI();
  runtime.register({ id: "browser-test", plugin: transformersJsPlugin({
    runtime: { async generate(_messages, options) {
      options.streamer.onText("ok");
      options.streamer.onToken();
    } },
    createStreamer: ({ onText, onToken }) => ({ onText, onToken })
  }) });
  const card = parseModelCard({ schemaVersion: "1.0", id: "test", execution: {
    plugin: "@arcanai/plugin-transformersjs", instance: "browser-test",
    model: "dummy", options: { maxTokens: 12 }
  } });
  const result = await runtime.generate({ card, messages: [{ role: "user", content: "hello" }] });
  assert.equal(result.text, "ok");
  assert.equal(result.usage.outputTokens, 1);
});

test("all provider subpath exports load from the public npm-style package boundary", () => {
  assert.equal(typeof openAICompatiblePlugin, "function");
  assert.equal(typeof openAIResponsesPlugin, "function");
  assert.equal(typeof anthropicMessagesPlugin, "function");
  const runtime = createArcanAI("off");
  runtime.register({ id: "local-api", plugin: openAICompatiblePlugin({
    baseUrl: "http://127.0.0.1:12345/v1/"
  }) });
  runtime.register({ id: "openai", plugin: openAIResponsesPlugin({
    apiKey: "test-only-secret"
  }) });
  runtime.register({ id: "anthropic", plugin: anthropicMessagesPlugin({
    apiKey: "test-only-secret"
  }) });
  assert.deepEqual(runtime.listInstances().map(x => x.id), [
    "local-api", "openai", "anthropic"
  ]);
});
