# Transformers.js parity adapter

**Status:** the injected-runtime parity bridge and separately implemented provider-owned loader both exist. Deterministic mock tests are not real BML A/B or headless Node model-acceptance evidence; those remain hardware-specific verification work.

`@arcanai/plugin-transformersjs` runs the same initialized Transformers.js model runtime as the existing BML executor through a narrow `TransformersModelRuntime` port. That is intentional for an attribution-quality comparison: the same weights, tokenizer, prompt renderer, generation options, stopping criteria, model cache, and device must be used on both paths.

It supports both BML runtime implementations: `pipeline` and `direct-model`. These are *runtime modes*, not different model-specific plugins. A single plugin implementation covers all six models in BML's `experiments/mara-dialogue/` folder:

| BML candidate | Runtime mode |
| --- | --- |
| Qwen3 0.6B | pipeline |
| LFM3 1.7B | pipeline |
| SmolLM2 1.7B | pipeline |
| Qwen3.5 2B | direct-model |
| SmolLM3 3B | pipeline |
| Qwen3 4B | pipeline |

The host owns initialization during this **parity bridge phase**. ArcanAI's plugin owns translation of common options into Transformers.js generation options and execution against the injected runtime port. This avoids prematurely rewriting a working BML inference engine and confusing changes to prompt rendering with plugin overhead. The eventual stable endpoint is for the plugin to own model loading and compatibility profiles, after parity and schema migration.

## Contract

```ts
const plugin = transformersJsPlugin({
  runtime: alreadyInitializedTransformersRuntime,
  createStreamer: ({ onText, onToken }) => new TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: onText,
    token_callback_function: onToken
  }),
  stoppingCriteria
});
```

The selected ArcanAI card declares `@arcanai/plugin-transformersjs`, a named instance, model ID and common/options overrides. The host's existing model-card profile creates the final model invocation during migration. It must not bypass ArcanAI's common card validation. The plugin supports provider options `doSample`, `topK`, `minP`, `presencePenalty`, `repetitionPenalty` and `tokenizerEncodeOptions`; unknown options produce a clear error.

No package installation, fetching of model weights, background version polling, retries or job scheduling is performed by ArcanAI.

## Benchmark methodology

Measure the baseline and ArcanAI path *in the same BML benchmark harness* using the exact same card, prompt, generation settings, cached weights, machine, Transformers.js version, concurrency and model runtime. Run native and plugin paths as alternating trials, warmed, with separate raw artifacts. Capture per-request generation time, first-token time, generated token count, score, and complete model-revision identity. Compute median and dispersion of paired run differences; don't claim a percentage overhead from a single run. When sampling is enabled, compare distributions rather than expecting identical strings. Distinguish model load time from invocation dispatch time. Report no numerical performance claim until real target-hardware runs complete.

See the BML integration PR for opt-in runner wiring; neither existing BML benchmark path nor its historical cards is replaced until parity is established.
