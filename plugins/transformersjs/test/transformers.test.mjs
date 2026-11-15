import test from "node:test";
import assert from "node:assert/strict";
import { createArcanAI, parseModelCard } from "../../../dist/src/index.js";
import { transformersJsPlugin, transformersGenerationOptions } from "../dist/index.js";

const cards = ["qwen3-0.6b", "lfm3-1.7b", "smollm2-1.7b", "qwen35-2b", "smollm3-3b", "qwen3-4b"].map(id =>
  parseModelCard({
    schemaVersion: "1.0", id,
    execution: { plugin: "@arcanai/plugin-transformersjs", instance: id,
      model: id, options: { maxTokens: 32 }, providerOptions: { doSample: false, topK: 20 } }
  })
);

test("same adapter executes six named cards, including a direct-model runtime", async () => {
  const runtime = createArcanAI();
  const input = [];
  for (const card of cards) {
    const id = card.id;
    const engine = { async generate(messages, opts) {
      input.push({ id, messages, opts });
      opts.streamer.onText("answer for " + id);
      opts.streamer.onToken();
    } };
    runtime.register({
      id,
      plugin: transformersJsPlugin({
        runtime: engine,
        createStreamer: ({ onText, onToken }) => ({ onText, onToken })
      })
    });
  }
  for (const card of cards) {
    const result = await runtime.generate({ card, messages: [{ role: "user", content: "hello" }] });
    assert.equal(result.status, "success");
    assert.equal(result.text, "answer for " + card.id);
    assert.equal(result.usage.outputTokens, 1);
  }
  assert.equal(input.length, 6);
  assert.ok(input.every(v => v.opts.max_new_tokens === 32 && v.opts.do_sample === false && v.opts.top_k === 20));
});

test("rejects unknown option without dispatching to a runtime", async () => {
  const options = { model: "foo", messages: [], options: { maxTokens: 8 }, providerOptions: { unknown: 1 } };
  assert.throws(() => transformersGenerationOptions(options), /Unsupported/);
});

test("concurrency is isolated by instance and rejected within the same instance", async () => {
  let resolve;
  let started;
  const began = new Promise(r => { started = r; });
  const held = new Promise(r => { resolve = r; });
  const plugin = transformersJsPlugin({
    runtime: { async generate(_messages, opts) { started(); await held; opts.streamer.onText("done"); opts.streamer.onToken(); } },
    createStreamer: ({ onText, onToken }) => ({ onText, onToken })
  });
  const runtime = createArcanAI();
  runtime.register({ id: "qwen3-0.6b", plugin });
  const card = cards[0];
  const first = runtime.generate({ card, messages: [] });
  await began;
  const second = await runtime.generate({ card, messages: [] });
  assert.equal(second.status, "error");
  assert.equal(second.error.code, "INSTANCE_BUSY");
  resolve();
  assert.equal((await first).status, "success");
});

test("cancellation interrupts local model stopping criteria", async () => {
  const controller = new AbortController();
  let interrupted = false;
  const runtime = createArcanAI();
  runtime.register({
    id: "qwen3-0.6b",
    plugin: transformersJsPlugin({
      runtime: { async generate() { controller.abort(); } },
      createStreamer: () => ({}),
      stoppingCriteria: { reset() {}, interrupt() { interrupted = true; } }
    })
  });
  const result = await runtime.generate({ card: cards[0], messages: [], signal: controller.signal });
  assert.equal(result.status, "cancelled");
  assert.equal(interrupted, true);
});
