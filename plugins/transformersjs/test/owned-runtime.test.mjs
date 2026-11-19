import test from "node:test";
import assert from "node:assert/strict";
import { createArcanAI, parseModelCard } from "../../../dist/src/index.js";
import { loadTransformersJsInstance } from "../dist/index.js";

function card(kind = "pipeline") {
  return parseModelCard({
    schemaVersion: "1.0", id: "model-test", execution: {
      plugin: "@arcanai/plugin-transformersjs", instance: "mac",
      model: "test/model", options: { maxTokens: 12 },
      runtime: {
        kind, revision: "main", device: "webgpu", dtype: kind === "pipeline" ? "q4" : {
          embed_tokens: "q4", vision_encoder: "fp16", decoder_model_merged: "q4"
        },
        ...(kind === "direct-model" ? { modelClass: "Qwen3_5ForConditionalGeneration", processorClass: "AutoProcessor" } : {})
      }
    }
  });
}
class Criteria {
  reset() {}
  interrupt() {}
}
function streamerConfig() {
  return class {
    constructor(tokenizer, settings) { this.settings = settings; }
  };
}
test("the plugin owns pipeline loading, tokenizer, inference and disposal", async () => {
  let loaded = 0, disposed = 0, calls = [];
  const sdk = {
    InterruptableStoppingCriteria: Criteria,
    TextStreamer: streamerConfig(),
    async pipeline(task, model, options) {
      loaded++; calls.push({ task, model, options });
      const fn = async (messages, generation) => {
        calls.push({ messages, generation });
        generation.streamer.settings.token_callback_function();
        generation.streamer.settings.callback_function("Hello!");
      };
      fn.tokenizer = { chat_template: "template", apply_chat_template: () => "rendered" };
      fn.dispose = async () => { disposed++; };
      return fn;
    }
  };
  const model = card();
  const loadedRuntime = await loadTransformersJsInstance(model, { sdk });
  const host = createArcanAI();
  host.register({ id: "mac", plugin: loadedRuntime.plugin });
  const result = await host.generate({ card: model, messages: [{ role: "user", content: "hi" }] });
  assert.equal(result.status, "success");
  assert.equal(result.text, "Hello!");
  assert.equal(result.usage.outputTokens, 1);
  assert.equal(loadedRuntime.runtime.renderPrompt([{ role: "user", content: "hi" }]), "rendered");
  assert.equal(calls[0].model, "test/model");
  await loadedRuntime.dispose();
  assert.equal(loaded, 1);
  assert.equal(disposed, 1);
});

test("the same plugin handles typed image requests through its own processor", async () => {
  let resized, prepared;
  const tokenizer = { chat_template: "vision-template" };
  const processor = Object.assign(async (text, image) => { prepared = { text, image }; return { input_ids: [1] }; }, {
    tokenizer, apply_chat_template: () => "rendered-image"
  });
  const model = {
    async generate(args) {
      args.streamer.settings.token_callback_function();
      args.streamer.settings.callback_function("blue");
    },
    async dispose() {}
  };
  const sdk = {
    InterruptableStoppingCriteria: Criteria,
    TextStreamer: streamerConfig(),
    AutoProcessor: { async from_pretrained() { return processor; } },
    Qwen3_5ForConditionalGeneration: { async from_pretrained() { return model; } },
    RawImage: { async read(url) {
      assert.equal(url, "data:image/png;base64,AAAA");
      return { resize(width, height) { resized = [width, height]; return { pixels: true }; } };
    } }
  };
  const loadedRuntime = await loadTransformersJsInstance(card("direct-model"), { sdk });
  const host = createArcanAI();
  host.register({ id: "mac", plugin: loadedRuntime.plugin });
  const result = await host.generate({
    card: card("direct-model"),
    messages: [{ role: "user", content: [
      { type: "text", text: "What color?" },
      { type: "image", source: { type: "url", url: "data:image/png;base64,AAAA" } }
    ] }]
  });
  assert.equal(result.status, "success");
  assert.equal(result.text, "blue");
  assert.deepEqual(resized, [448, 448]);
  assert.equal(prepared.text, "rendered-image");
  assert.deepEqual(prepared.image, { pixels: true });
  await loadedRuntime.dispose();
});

test("unsupported image capability is rejected without flattening images", async () => {
  const sdk = {
    InterruptableStoppingCriteria: Criteria,
    TextStreamer: streamerConfig(),
    async pipeline() {
      const fn = async () => {};
      fn.tokenizer = { apply_chat_template() { return "prompt"; } };
      fn.dispose = async () => {};
      return fn;
    }
  };
  const loadedRuntime = await loadTransformersJsInstance(card(), { sdk });
  const host = createArcanAI();
  host.register({ id: "mac", plugin: loadedRuntime.plugin });
  const result = await host.generate({ card: card(), messages: [{ role: "user", content: [
    { type: "text", text: "What is it?" },
    { type: "image", source: { type: "url", url: "data:image/png;base64,AAAA" } }
  ] }] });
  assert.equal(result.status, "error");
  assert.equal(result.error.code, "UNSUPPORTED_CONTENT");
  await loadedRuntime.dispose();
});

test("headless Node CPU path uses card-owned runtime settings and disposes after inference", async () => {
  let requestedDevice, called = false, disposed = false;
  const sdk = {
    InterruptableStoppingCriteria: Criteria,
    TextStreamer: streamerConfig(),
    async pipeline(_task, _model, options) {
      requestedDevice = options.device;
      const fn = async (_messages, generated) => {
        called = true;
        generated.streamer.settings.token_callback_function();
        generated.streamer.settings.callback_function("CPU inference passed");
      };
      fn.tokenizer = { apply_chat_template() { return "rendered"; } };
      fn.dispose = async () => { disposed = true; };
      return fn;
    }
  };
  const cpuCard = parseModelCard({
    schemaVersion: "1.0", id: "cpu-only",
    execution: {
      plugin: "@arcanai/plugin-transformersjs", instance: "node-cpu",
      model: "fixture/small-instruct", options: { maxTokens: 12 },
      runtime: { kind: "pipeline", device: "cpu", revision: "fixture-v1", dtype: "q4" }
    }
  });
  const loaded = await loadTransformersJsInstance(cpuCard, { sdk });
  try {
    const host = createArcanAI("off");
    host.register({ id: "node-cpu", plugin: loaded.plugin });
    const result = await host.generate({
      card: cpuCard, messages: [{ role: "user", content: "Hello" }]
    });
    assert.equal(result.status, "success");
    assert.equal(result.text, "CPU inference passed");
    assert.equal(requestedDevice, "cpu");
    assert.equal(called, true);
  } finally { await loaded.dispose(); }
  assert.equal(disposed, true);
});
