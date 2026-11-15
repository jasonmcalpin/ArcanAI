import test from "node:test";
import assert from "node:assert/strict";
import { parseModelCard } from "../../../dist/src/index.js";
import { prepareModelInvocationFromCard, prepareVisionInvocationFromCard,
  parseModelOutputFromCard } from "../dist/index.js";

const card = parseModelCard({
  schemaVersion: "1.0", id: "portable", execution: {
    plugin: "@arcanai/plugin-transformersjs", instance: "local", model: "model",
    runtime: { kind: "pipeline", dtype: "q4", revision: "main", device: "webgpu" },
    profile: {
      id: "native-tools-v1", family: "qwen", adapterId: "declarative-v1",
      chat: { renderer: "tokenizer-template", promptPlacement: "preserve-roles",
        historyReasoning: "template-managed" },
      tools: { mode: "native-template", callFormat: "tagged-json", tokenizerTools: true,
        callParser: "json-or-tagged-json", definitionFormat: "openai-functions" },
      reasoning: { supported: true, defaultMode: "non-thinking", control: "enable_thinking",
        enabledForBenchmark: false },
      profiles: { production: { doSample: true }, direct: { doSample: false },
        tool: { doSample: false } },
      visionProfile: { temperature: 0.7 }
    }
  }
});

test("a canonical card independently describes runtime, prompt/tool protocol and generation", () => {
  const prepared = prepareModelInvocationFromCard(card, {
    messages: [{ role: "user", content: "Say hello" }],
    workload: "direct", maxNewTokens: 64
  });
  assert.deepEqual(prepared.tokenizerEncodeOptions, { enable_thinking: false });
  assert.equal(prepared.settings.maxNewTokens, 64);
  assert.equal(prepared.settings.doSample, false);
  assert.equal(card.execution.runtime.kind, "pipeline");
  assert.equal(card.execution.profile.id, "native-tools-v1");
});

test("vision and output interpretation share the same card", () => {
  const vision = prepareVisionInvocationFromCard(card, "data:image/png;base64,AA", "What color?", 96);
  assert.equal(vision.settings.temperature, 0.7);
  const result = parseModelOutputFromCard(card, '{"type":"final","answer":"Hello!"}');
  assert.deepEqual(result.turn, { type: "final", answer: "Hello!" });
});

test("missing profile is not silently replaced with defaults", () => {
  const missing = parseModelCard({ schemaVersion: "1.0", id: "missing", execution: {
    plugin: "@arcanai/plugin-transformersjs", model: "model", runtime: { kind: "pipeline", dtype: "q4" }
  } });
  assert.throws(() => prepareModelInvocationFromCard(missing, {
    messages: [], workload: "direct", maxNewTokens: 8
  }), /execution\.profile/);
});
