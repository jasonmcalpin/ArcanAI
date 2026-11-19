# ArcanAI implementation status

**Evidence boundary:** This inventory describes current source code and automated tests. A successful CI build, exported SDK interface or fixture-driven provider test does not establish real model compatibility, provider permissions, Mac hardware performance, or an authenticated deployment.

## Implemented in source and tested

| Capability | Owner | Verification boundary |
| --- | --- | --- |
| Canonical execution card v1.0 | `src/cards.ts`, `src/types.ts` | Schema/common settings/provider/runtime/profile data validation and contract tests; not a universal provider capability manifest |
| Explicit registered instances | `src/core.ts` | Named instances, duplicate rejection and no automatic discovery, registration or installation |
| Generation and streaming | `src/core.ts` | `generate()` and `stream()` use the same event path; text, reasoning, structured tool-call **output**, success/failure and cancellation |
| Execution supervision | `src/supervision.ts` | Heartbeat, idle and total timers; abort propagation; one terminal outcome. Cannot interrupt a frozen JS event loop or forcibly cancel non-cooperative native work |
| Host capability/capture policy | `src/execution-policy.ts`, `src/core.ts` | Adapter-declared capability requirements, host token ceilings, cumulative text/reasoning/tool/diagnostic capture bounds. No BML model qualification or provider memory budget |
| Diagnostics | `src/core.ts` | Off/basic/verbose/trace with bounded retained events and observer isolation. Comprehensive redaction of arbitrary plugin-supplied text remains unverified |
| Native Ollama | `plugins/ollama/` | Native `/api/chat` NDJSON text, reasoning, tools, usage and cancellation; HTTP fixture tests, not a claim of installed Mac models |
| Owned Transformers.js | `plugins/transformersjs/` | Pipeline/direct-model profiles, Node CPU and WebGPU selections, tokenizer/preprocessing, bounded vision, cancellation and disposal. Mock CPU and loader tests are not real model benchmarks |
| OpenAI-compatible HTTP | `plugins/openai-compatible/` | Explicit endpoint, supported Chat Completions SSE subset, structured calls, usage/errors/cancellation; per-service compatibility with llama.cpp/LM Studio must be checked |
| Direct OpenAI Responses | `plugins/openai/` | Independent Responses SSE text/function events, usage/errors and cancellation, host-supplied API key; no live authenticated run verified |
| Direct Anthropic Messages | `plugins/anthropic/` | Independent Messages SSE text/thinking/tool_use events, usage/errors and cancellation, host-supplied API key; no live authenticated run verified |
| Node model card catalog | `src/node/cards.ts` | Host-selected JSON files; filesystem APIs live only under the Node subpath |
| Browser-neutral SDK core | `src/core.ts`, `src/types.ts` | Core avoids Node filesystem dependencies. Browser packaging/WebGPU inference are not qualified here |
| Headless Node model acceptance command | `scripts/smoke-headless-transformers.mjs` | Runs an explicitly selected model card and reports results/cleanup when executed by the operator; not run against real Mac weights in CI |
| Git-distributed package exports | `package.json`, `test/consumer-import.test.mjs` | Public package/subpath imports and build; package unpublished, plugins not auto-registered |

## Already present in adjacent consumers

**Browser Model Lab** currently runs ArcanAI by default in its browser and Node execution modes, maintains a native Node rollback path, uses a versioned historical-card bridge and supports paired native-vs-ArcanAI artifact comparisons. This is stronger than an unimplemented migration proposal but does **not** establish paired real-model performance parity. BML owns benchmark scoring and evidence; ArcanAI owns inference.

**Aether** already consumes ArcanAI with Ollama/Transformers.js plugin selection and an agent-owned tool loop. Its pinned ArcanAI dependency may predate new provider releases; new plugins are not available there until a reviewed dependency update and consumer test.

## Outstanding acceptance, implementation and design

1. **Target Mac headless model qualification:** Run one or more approved small Transformers.js model cards using real local weights, verify CPU/device behavior, cleanup, timeouts, memory and output/usage; keep artifact evidence. A fixture-driven Node test is not a hardware proof.
2. **Local services:** Verify Ollama, a selected compatible llama.cpp or LM Studio endpoint, network permissions, streaming, supported options and tool-call protocols with deployed models.
3. **Authenticated hosted APIs:** Verify API-key access, model availability, provider/version-specific streaming events, tool history and billing/usage separately for OpenAI and Anthropic. Consumer subscriptions are not API credentials.
4. **Gemini Interactions:** Not implemented. Its stateless continuation requires preserving provider-origin model/thought/function steps and thought signatures. ArcanAI's present canonical `Message` type cannot faithfully reconstruct all of that state. Extend the provider continuation contract (or use explicit stateful interaction IDs) before claiming an agent-tool-capable Gemini adapter.
5. **Provider lifecycle:** Formalize required start/stop/dispose semantics and concurrency control across providers, avoiding a speculative generic runtime.
6. **BML/Aether parity:** Update reviewed pinned dependencies, verify equivalent execution-card semantics and test actual paired runs on target hardware. Do not rewrite historical benchmark artifacts or infer qualifications.
7. **Security:** Improve sanitization and redaction for arbitrary provider errors/diagnostic payloads. Browser secrets must stay behind trusted hosts/gateways. In-process native plugins are not sandboxes.
8. **Optional browser/WebGPU:** Validate packaging and runtime only for a browser consumer that needs it. Never block the Mac-based Aether workflow.
9. **Distribution:** Versioned npm publication and historical BML card compatibility/migrations remain future release work.

The next decision point is **actual target-environment evidence** rather than another general-purpose provider abstraction. The current provider plugin boundaries should remain independent.
