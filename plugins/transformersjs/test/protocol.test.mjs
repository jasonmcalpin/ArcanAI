import test from "node:test";
import assert from "node:assert/strict";
import { prepareModelInvocation, prepareVisionInvocation, parseModelOutput } from "../dist/index.js";

const candidate = {
  id: "model-one", family: "family-one", adapterId: "declarative-v1",
  compatibilityProfileId: "profile-one",
  compatibilityProfile: {
    id: "profile-one", family: "family-one", adapterId: "declarative-v1",
    runtime: { kind: "pipeline", dtype: "q4" },
    chat: { renderer: "tokenizer-template", promptPlacement: "preserve-roles", historyReasoning: "template-managed" },
    tools: {
      mode: "native-template", callFormat: "tagged-json", callParser: "json-or-tagged-json",
      tokenizerTools: true, definitionFormat: "openai-functions"
    },
    reasoning: { supported: true, defaultMode: "thinking", control: "enable_thinking", enabledForBenchmark: false },
    profiles: {
      production: { doSample: true, temperature: 0.7, topP: 0.8 },
      direct: { doSample: false },
      tool: { doSample: false, topK: 20 }
    },
    visionProfile: { doSample: false, temperature: 0.4 }
  }
};

test("portable profile prepares direct and tool invocations without host logic", () => {
  const direct = prepareModelInvocation(candidate, {
    messages: [{ role: "user", content: "hi" }], workload: "direct", maxNewTokens: 48
  });
  assert.deepEqual(direct.tokenizerEncodeOptions, { enable_thinking: false });
  assert.equal(direct.settings.maxNewTokens, 48);
  assert.equal(direct.settings.doSample, false);

  const tool = prepareModelInvocation(candidate, {
    messages: [{ role: "user", content: "inspect" }], workload: "tool", maxNewTokens: 32,
    tools: [{ name: "inspect_relay", description: "Inspect a relay", inputSchema: {
      type: "object", properties: { id: { type: "string", description: "Relay" } },
      required: ["id"], additionalProperties: false
    } }]
  });
  assert.equal(tool.settings.topK, 20);
  assert.equal(tool.tokenizerEncodeOptions.tools[0].function.name, "inspect_relay");
  assert.equal(tool.adapterId, "declarative-v1");
});

test("profile parser preserves final output, reasoning separation and structured tool calls", () => {
  const parsed = parseModelOutput(candidate, '<think>reason</think>\n<tool_call>[{"name":"inspect_relay","arguments":{"id":"R-17"}}]</tool_call>');
  assert.ok(parsed.reasoningTokens >= 1);
  assert.deepEqual(parsed.turn, { type: "tool_call", call: { tool: "inspect_relay", args: { id: "R-17" } } });
});

test("vision preparation remains profile-owned", () => {
  const value = prepareVisionInvocation(candidate, "data:image/png;base64,AA", "Color?", 96);
  assert.equal(value.imageUrl, "data:image/png;base64,AA");
  assert.equal(value.settings.maxNewTokens, 96);
  assert.equal(value.settings.temperature, 0.4);
});
