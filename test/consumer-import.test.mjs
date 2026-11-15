import test from "node:test";
import assert from "node:assert/strict";
import { createArcanAI, parseModelCard } from "arcanai";
import { transformersJsPlugin } from "arcanai/plugins/transformersjs";
import { ollamaPlugin } from "arcanai/plugins/ollama";

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
