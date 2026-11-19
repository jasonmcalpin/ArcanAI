#!/usr/bin/env node
/**
 * Operator-invoked headless Node acceptance. Real weights and device
 * compatibility are deliberately not inferred from a test card.
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createArcanAI, parseModelCard } from "../dist/src/index.js";
import { loadTransformersJsInstance } from "../plugins/transformersjs/dist/index.js";

function option(name, required = false) {
  const i = process.argv.indexOf(name);
  const value = i < 0 ? undefined : process.argv[i + 1];
  if (required && (!value || value.startsWith("--"))) throw Error("Missing " + name);
  return value;
}
const filename = option("--card", true);
const prompt = option("--prompt") ?? "Reply with one short sentence confirming local inference.";
const maxTokens = Number(option("--max-tokens") ?? "64");
if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 512 ||
    prompt.length < 1 || prompt.length > 8192) {
  throw Error("Prompt and maxTokens exceed the operator smoke-test bounds");
}
const full = path.resolve(filename);
const info = await stat(full);
if (!info.isFile() || info.size > 256 * 1024) throw Error("Model card must be a bounded regular file");
const card = parseModelCard(JSON.parse(await readFile(full, "utf8")));
if (card.execution.plugin !== "@arcanai/plugin-transformersjs") {
  throw Error("Headless Node smoke requires the Transformers.js plugin");
}
const evidence = {
  modelCard: card.id,
  model: card.execution.model,
  runtime: card.execution.runtime,
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  startedAt: new Date().toISOString(),
};
console.error(JSON.stringify({ event: "model-load-started", evidence }));
let loaded;
try {
  loaded = await loadTransformersJsInstance(card, {
    onProgress(info) {
      // Do not log model payloads, secrets or source file contents.
      console.error(JSON.stringify({ event: "model-load-progress", status: info.status ?? "unknown" }));
    },
  });
  const sdk = createArcanAI("off");
  sdk.register({ id: card.execution.instance ?? "headless-node", plugin: loaded.plugin,
    capabilities: { schemaVersion: "1", modalities: ["text"], streaming: false, toolCalls: false },
    limits: { maxTokens, maxOutputBytes: 32 * 1024, maxReasoningBytes: 8 * 1024 } });
  const startedAt = performance.now();
  const response = await sdk.generate({
    card, instance: card.execution.instance ?? "headless-node",
    messages: [{ role: "user", content: prompt }],
    options: { maxTokens },
    requiredCapabilities: ["text"],
    timers: { heartbeatMs: 1000, idleMs: 120000, totalMs: 300000 },
  });
  const output = { ...evidence, durationMs: Math.round(performance.now() - startedAt),
    status: response.status, finishReason: response.finishReason,
    usage: response.usage, providerMetadata: response.providerMetadata,
    responseChars: response.text?.length ?? 0,
    error: response.error ?? null, finishedAt: new Date().toISOString() };
  console.log(JSON.stringify(output, null, 2));
  if (response.status !== "success" || !response.text?.trim()) process.exitCode = 1;
} finally {
  if (loaded) {
    await loaded.dispose();
    console.error(JSON.stringify({ event: "runtime-disposed" }));
  }
}
