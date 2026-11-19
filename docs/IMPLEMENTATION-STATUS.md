# ArcanAI implementation status

**Evidence boundary:** This inventory reflects the implementation and checked-in tests on the reviewed `main` branch, not a newly executed hardware benchmark or deployed provider acceptance. An exported API is not proof that every model/device/provider works. Historical worklogs and PR references remain historical.

## Implemented in source

| Capability | Owner/source | Evidence and limitations |
| --- | --- | --- |
| Canonical versioned execution card and validation | `src/cards.ts`, `src/types.ts` | `schemaVersion: "1.0"`; common generation settings and JSON provider/runtime/profile fields validated. Not a full plugin compatibility or host-policy-ceiling negotiation system. |
| Named explicit plugin instances | `src/core.ts` | `register()`, duplicate-instance rejection, `listInstances()`; no provider auto-activation or installation. |
| Model call and streaming results | `src/core.ts` | `generate()` consumes the same async stream that `stream()` exposes. Text/reasoning deltas, structured tool-call **output**, and terminal result supported. ArcanAI never executes tools. |
| Supervision | `src/supervision.ts` | Per-call heartbeat, idle and total timers; abort propagation; one terminal outcome. In-process event-loop stalls and noncooperative provider cleanup cannot be forcibly interrupted. |
| Diagnostics | `src/core.ts` | `off/basic/verbose/trace`, max-level capping and callback isolation. Arbitrary plugin diagnostic payload redaction is **not established**; no blanket production-safety claim. |
| Ollama provider | `plugins/ollama/src/index.ts` | Native `POST /api/chat` NDJSON streaming, model text/reasoning, tool calls, usage, options/conflict checks and abort support. Protocol tests use injected `fetch`; an actual running Ollama deployment is a separate acceptance test. |
| Transformers.js provider | `plugins/transformersjs/src/index.ts`, `runtime.ts` | Plugin-owned loader `loadTransformersJsInstance(card)`, pipeline/direct-model profiles, CPU/WebGPU device options, generation/token callbacks, cancellation and disposal. Runtime/card compatibility is model/device specific; mocked loader tests are not live Node or browser parity evidence. |
| Typed text and limited image input | `src/types.ts`, Transformers.js plugin | Text/image URL parts represented; Transformers.js supports a bounded **single user image and prompt** for an appropriate runtime. Other combinations are not silently flattened. |
| Host-selected Node card catalog | `src/node/cards.ts` | `readModelCards({root,path})` and legacy string form; explicit file/folder selection with path validation. This subpath uses Node filesystem APIs. |
| Browser-neutral core | `src/core.ts`, `src/types.ts` | Core avoids Node filesystem imports. Actual browser bundling, WebGPU and model execution need independently verified browser acceptance. |
| Consumable Git-distributed package | `package.json`, `docs/CONSUMING.md` | Subpath exports and build scripts. Package remains private/unpublished; installing does not register or provision providers. |

## Not yet established as implemented

- Headless **real-model** acceptance matrix for embedded Transformers.js on the target Mac in Node (model ID, revision, dtype, device and lifecycle), distinct from unit tests and compatibility in BML.
- End-to-end parity showing BML and Aether run identical approved execution cards/plugins with equivalent effective settings and evidence.
- Browser/WebGPU packaged/runtime acceptance. Browser remains optional for Aether, useful for BML and other clients.
- OpenAI-compatible HTTP provider for compatible llama.cpp/LM Studio/local gateways; direct OpenAI, Anthropic and Gemini API plugins; native llama.cpp binding.
- Versioned plugin capability/compatibility negotiation; host-enforced hard ceilings across card/request overrides; universal instance lifecycle/concurrency management.
- Bounded aggregate streaming capture/diagnostic retention and comprehensive secret-safe logging across arbitrary plugins.
- Published versioned npm packages and migration/compatibility guarantees for all historical BML cards.
- Broad modality support beyond current bounded text and Transformers.js image path.

## Delivery order (architectural dependencies, not an MVP)

1. **Contract hardening:** Lock down current public API, provider capability reporting, host ceilings, capture budgets, lifecycle/cleanup and evidence semantics while preserving the implemented card v1.0 format or explicitly migrating it.
2. **Headless Node acceptance:** Run a target small-model suite through ArcanAI's owned Transformers.js loader on macOS; verify fallback, cancellation, memory, initialization/disposal and determinism/usage evidence. Retain Ollama contract acceptance.
3. **Provider expansion:** First a bounded OpenAI-compatible HTTP adapter for compatible local servers; then independent direct hosted API adapters where protocol and authentication semantics warrant them. No model-name switches in core.
4. **Consumer parity:** Migrate BML away from duplicate inference engines only after model-card equivalence and real target-machine parity; validate Aether uses the same approved execution cards.
5. **Optional browser acceptance:** Verify WebGPU/browser portability if a BML or application scenario requires it; never impose browser requirements on Node/Aether.

No implementation or hardware verification is implied by this document-only reconciliation.
