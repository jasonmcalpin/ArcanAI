import test from "node:test";
import assert from "node:assert/strict";
import { createArcanAI, parseModelCard, CardValidationError } from "../src/index.js";
import type { ModelPlugin } from "../src/index.js";

const card = parseModelCard({
  schemaVersion: "1.0", id: "test",
  execution: { plugin: "test/echo", instance: "mac", model: "echo:1", options: { maxTokens: 64 }, providerOptions: { num_ctx: 4096 } }
});

test("cards are declarative, validated, and reject executable provider settings", () => {
  assert.equal(card.execution.plugin, "test/echo");
  assert.throws(() => parseModelCard({ ...card, schemaVersion: "9" }), CardValidationError);
  assert.throws(() => parseModelCard({ ...card, execution: { ...card.execution, providerOptions: { fn: () => null } } }), CardValidationError);
  assert.throws(() => parseModelCard({ ...card, execution: { ...card.execution, options: { mystery: 1 } } }), CardValidationError);
});

test("missing plugin reports status without triggering installation", async () => {
  const runtime = createArcanAI();
  const response = await runtime.generate({ card, messages: [] });
  assert.equal(response.status, "unavailable");
  assert.equal(response.error?.code, "PLUGIN_NOT_FOUND");
});

test("same plugin supports separate instances and precedence", async () => {
  const inputs: Array<{ model: string; num_ctx: unknown; maxTokens: unknown }> = [];
  const plugin: ModelPlugin = {
    id: "test/echo",
    async execute(req) {
      inputs.push({ model: req.model, num_ctx: req.providerOptions.num_ctx, maxTokens: req.options.maxTokens });
      return { text: typeof req.messages[0]?.content === "string" ? req.messages[0].content : "" };
    }
  };
  const runtime = createArcanAI();
  runtime.register({ id: "mac", plugin, defaults: { options: { maxTokens: 8 }, providerOptions: { num_ctx: 2048 } } });
  runtime.register({ id: "mini", plugin, defaults: { providerOptions: { num_ctx: 1024 } } });
  const first = await runtime.generate({ card, messages: [{ role: "user", content: "hello" }] });
  const second = await runtime.generate({ card, instance: "mini", messages: [], options: { maxTokens: 17 }, providerOptions: { num_ctx: 512 } });
  assert.equal(first.status, "success");
  assert.equal(first.text, "hello");
  assert.equal(second.status, "success");
  assert.deepEqual(inputs, [
    { model: "echo:1", num_ctx: 4096, maxTokens: 64 },
    { model: "echo:1", num_ctx: 512, maxTokens: 17 }
  ]);
});

test("diagnostics are opt-in and logger failures do not interrupt execution", async () => {
  const runtime = createArcanAI();
  runtime.register({ id: "mac", plugin: { id: "test/echo", async execute(_request, context) { context.log("debug", "sent to provider"); return { text: "ok" }; } } });
  const off = await runtime.generate({ card, messages: [] });
  const verbose = await runtime.generate({ card, messages: [], diagnostics: "verbose", onDiagnostic() { throw new Error("logging failed"); } });
  assert.equal(off.diagnostics, undefined);
  assert.equal(verbose.status, "success");
  assert.ok(verbose.diagnostics?.some(event => event.message === "sent to provider"));
});

test("cancellation reported even if plugin finishes after abort", async () => {
  const controller = new AbortController();
  const runtime = createArcanAI();
  runtime.register({ id: "mac", plugin: { id: "test/echo", async execute() { controller.abort(); return { text: "late" }; } } });
  const response = await runtime.generate({ card, messages: [], signal: controller.signal });
  assert.equal(response.status, "cancelled");
  assert.equal(response.text, undefined);
});

test("duplicate registrations are rejected", () => {
  const runtime = createArcanAI();
  const plugin: ModelPlugin = { id: "test/echo", async execute() { return { text: "ok" }; } };
  runtime.register({ id: "mac", plugin });
  assert.throws(() => runtime.register({ id: "mac", plugin }), /duplicate/);
});

test("instance maxTokens is an effective ceiling even when card and request omit it", async () => {
  let observed: number | undefined;
  const sdk = createArcanAI("off");
  sdk.register({ id: "mac", limits: { maxTokens: 77 }, plugin: {
    id: "test/echo", async execute(req) {
      observed = req.options.maxTokens;
      return { text: "bounded" };
    }
  } });
  const noBudgetCard = parseModelCard({ schemaVersion: "1.0", id: "no-budget",
    execution: { plugin: "test/echo", instance: "mac", model: "local" } });
  const result = await sdk.generate({ card: noBudgetCard, messages: [] });
  assert.equal(result.status, "success");
  assert.equal(observed, 77);
  const tightened = await sdk.generate({ card: noBudgetCard, messages: [],
    limits: { maxTokens: 31 } });
  assert.equal(tightened.status, "success");
  assert.equal(observed, 31);
});
