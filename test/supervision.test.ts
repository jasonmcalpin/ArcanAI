import test from "node:test";
import assert from "node:assert/strict";
import { createArcanAI, parseModelCard } from "../src/index.js";

const card = parseModelCard({
  schemaVersion: "1.0", id: "slow-model",
  execution: { plugin: "test/slow", instance: "local", model: "test:model" }
});

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

test("heartbeat reports supervisor liveness without claiming provider progress", async () => {
  const runtime = createArcanAI();
  runtime.register({ id: "local", plugin: {
    id: "test/slow",
    async *stream() {
      await delay(85);
      yield { type: "text-delta", text: "done" } as const;
      yield { type: "completed" } as const;
    }
  } });
  const events = [];
  for await (const event of runtime.stream({ card, messages: [], timers: { heartbeatMs: 15 } })) events.push(event);
  assert.ok(events.some(event => event.type === "heartbeat" && event.elapsedMs >= 10));
  assert.equal(events.at(-1)?.type, "completed");
  assert.equal(events.at(-1)?.type === "completed" && events.at(-1)?.result.text, "done");
});

test("idle deadline reports timeout and aborts plugin signal", async () => {
  let signal: AbortSignal | undefined;
  const runtime = createArcanAI();
  runtime.register({ id: "local", plugin: {
    id: "test/slow",
    async *stream(_request, ctx) {
      signal = ctx.signal;
      await delay(100);
      yield { type: "completed" } as const;
    }
  } });
  const result = await runtime.generate({ card, messages: [], timers: { heartbeatMs: 10, idleMs: 35 } });
  assert.equal(result.status, "timeout");
  assert.equal(result.error?.code, "IDLE_TIMEOUT");
  assert.equal(signal?.aborted, true);
});

test("total deadline is not reset by provider activity", async () => {
  const runtime = createArcanAI();
  runtime.register({ id: "local", plugin: {
    id: "test/slow",
    async *stream() {
      for (let i = 0; i < 10; i++) {
        await delay(15);
        yield { type: "progress", message: "still working" } as const;
      }
      yield { type: "completed" } as const;
    }
  } });
  const result = await runtime.generate({ card, messages: [], timers: { heartbeatMs: 20, idleMs: 60, totalMs: 70 } });
  assert.equal(result.status, "timeout");
  assert.equal(result.error?.code, "EXECUTION_TIMEOUT");
});

test("caller abort interrupts a provider that has not yielded output", async () => {
  const controller = new AbortController();
  const runtime = createArcanAI();
  runtime.register({ id: "local", plugin: {
    id: "test/slow",
    async *stream() {
      await delay(200);
      yield { type: "completed" } as const;
    }
  } });
  setTimeout(() => controller.abort(), 25);
  const result = await runtime.generate({ card, messages: [], signal: controller.signal, timers: { heartbeatMs: 10 } });
  assert.equal(result.status, "cancelled");
});

test("invalid timer configuration fails before provider execution", async () => {
  const runtime = createArcanAI();
  let invoked = false;
  runtime.register({ id: "local", plugin: { id: "test/slow", async execute() { invoked = true; return { text: "ok" }; } } });
  await assert.rejects(
    runtime.generate({ card, messages: [], timers: { heartbeatMs: 0 } }),
    /must be a positive integer/
  );
  assert.equal(invoked, false);
});
