import test from "node:test";
import assert from "node:assert/strict";
import { createArcanAI, parseModelCard } from "../src/index.js";
import type { ModelPlugin, PluginStreamEvent } from "../src/index.js";

const card = parseModelCard({
  schemaVersion: "1.0", id: "stream-model",
  execution: { plugin: "test/stream", instance: "local", model: "model:1" }
});

test("stream and generate share the same text and terminal semantics", async () => {
  const plugin: ModelPlugin = {
    id: "test/stream",
    async *stream(): AsyncIterable<PluginStreamEvent> {
      yield { type: "text-delta", text: "hel" };
      yield { type: "text-delta", text: "lo" };
      yield { type: "completed", finishReason: "stop", usage: { outputTokens: 2 } };
    }
  };
  const runtime = createArcanAI();
  runtime.register({ id: "local", plugin });
  const events = [];
  for await (const event of runtime.stream({ card, messages: [] })) events.push(event);
  assert.deepEqual(events.map(x => x.type), ["started", "text-delta", "text-delta", "completed"]);
  assert.equal(events[1].type === "text-delta" && events[1].text, "hel");
  assert.equal(events[3].type === "completed" && events[3].result.text, "hello");
  const result = await runtime.generate({ card, messages: [] });
  assert.equal(result.status, "success");
  assert.equal(result.text, "hello");
  assert.deepEqual(result.usage, { outputTokens: 2 });
});

test("tool calls are preserved as structured outputs, not executed", async () => {
  const plugin: ModelPlugin = {
    id: "test/stream",
    async *stream() {
      yield { type: "tool-call" as const, toolCall: { id: "call1", name: "writeFile", arguments: { path: "/tmp/x" } } };
      yield { type: "completed" as const };
    }
  };
  const runtime = createArcanAI();
  runtime.register({ id: "local", plugin });
  const result = await runtime.generate({ card, messages: [] });
  assert.deepEqual(result.toolCalls, [{ id: "call1", name: "writeFile", arguments: { path: "/tmp/x" } }]);
  assert.equal(result.status, "success");
});

test("stream without completion returns a single terminal failure", async () => {
  const runtime = createArcanAI();
  runtime.register({ id: "local", plugin: { id: "test/stream", async *stream() { yield { type: "text-delta", text: "partial" } as const; } } });
  const events = [];
  for await (const event of runtime.stream({ card, messages: [] })) events.push(event);
  assert.deepEqual(events.map(x => x.type), ["started", "text-delta", "failed"]);
  const final = events[events.length - 1];
  assert.equal(final.type === "failed" && final.result.error?.code, "STREAM_INCOMPLETE");
});

test("events after provider completion are rejected without double-terminal output", async () => {
  const runtime = createArcanAI();
  runtime.register({ id: "local", plugin: {
    id: "test/stream",
    async *stream() {
      yield { type: "completed" } as const;
      yield { type: "text-delta", text: "late" } as const;
    }
  } });
  const events = [];
  for await (const event of runtime.stream({ card, messages: [] })) events.push(event);
  assert.deepEqual(events.map(x => x.type), ["started", "failed"]);
  const result = events[1];
  assert.equal(result.type === "failed" && result.result.error?.code, "PLUGIN_ERROR");
});

test("caller cancellation suppresses late completion", async () => {
  const abort = new AbortController();
  const runtime = createArcanAI();
  runtime.register({ id: "local", plugin: {
    id: "test/stream",
    async *stream() {
      yield { type: "text-delta", text: "partial" } as const;
      abort.abort();
      yield { type: "completed" } as const;
    }
  } });
  const events = [];
  for await (const event of runtime.stream({ card, messages: [], signal: abort.signal })) events.push(event);
  assert.deepEqual(events.map(x => x.type), ["started", "text-delta", "failed"]);
  assert.equal(events[2].type === "failed" && events[2].result.status, "cancelled");
});

test("abandoning a public stream aborts its plugin signal", async () => {
  let signal: AbortSignal | undefined;
  const runtime = createArcanAI();
  runtime.register({ id: "local", plugin: {
    id: "test/stream",
    async *stream(_request, context) {
      signal = context.signal;
      yield { type: "text-delta", text: "first" } as const;
      yield { type: "completed" } as const;
    }
  } });
  for await (const event of runtime.stream({ card, messages: [] })) {
    if (event.type === "text-delta") break;
  }
  assert.equal(signal?.aborted, true);
});

test("execute-only plugins are wrapped into the same stream protocol", async () => {
  const runtime = createArcanAI();
  runtime.register({ id: "local", plugin: { id: "test/stream", async execute() { return { text: "legacy" }; } } });
  const types: string[] = [];
  for await (const event of runtime.stream({ card, messages: [] })) types.push(event.type);
  assert.deepEqual(types, ["started", "text-delta", "completed"]);
});
