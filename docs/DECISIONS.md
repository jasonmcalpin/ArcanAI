# ArcanAI architecture decisions

**Status:** design record, not implementation status. Decisions summarize the agreed direction; examples and unresolved details do not become implemented guarantees merely by appearing here.

## Accepted decisions

| ID | Decision | Rationale / consequence |
| --- | --- | --- |
| D-001 | ArcanAI is a host-independent, npm-distributed model-execution SDK, not a package manager or orchestration engine. | Reuse plugins across BML, Aether and other hosts; do not duplicate npm or Aether responsibilities. |
| D-002 | Explicit plugin registration is the default. | Installed packages/cards do not imply code execution; host controls activated instances. |
| D-003 | Multiple configured instances per plugin are supported. | One provider adapter can target distinct machines/endpoints/models. |
| D-004 | ArcanAI owns the canonical model **execution** card format and validator. | BML and other hosts use identical execution configuration and plugin behavior; benchmark data belongs to BML. |
| D-005 | Model cards are declarative JSON; model-specific formats/options stay out of core source. | Adding model variants shouldn't require editing an engine; no executable code in cards. |
| D-006 | No installation, removal, download or upgrade operations in ArcanAI. | Missing required plugin is reported to user/developer; owner uses npm/Dependabot/project tooling. Earlier install prompt/auto-install ideas are **rejected**. |
| D-007 | Familiar OpenAI-style messages, Vercel-like provider options, typed results/events. | Low learning curve; adapters translate wire protocols. Not a promise of OpenAI endpoint compatibility. |
| D-008 | Common portable options plus plugin-owned `providerOptions`. | Avoid a growing universal switch list while retaining validation and no silent feature loss. |
| D-009 | Plugin is a model-request executor; host owns long-lived jobs, tools, retries, resume and recovery. | No second orchestration system within ArcanAI. |
| D-010 | Lightweight execution status plus optional verbose/trace narration. | Operators get enough evidence to troubleshoot; no provider API-compatibility database or automated diagnosis. |
| D-011 | No automatic request retry or provider upgrade/compatibility checks. | Avoid duplicate work/charges and perpetual edge-case maintenance. |
| D-012 | ArcanAI heartbeat means supervisor alive, not model progressing. | A quiet model may be working; honest observability. |
| D-013 | Shared plugin contracts and replaceable modules; trusted explicit in-process plugins initially. | Modularity is independence of decisions, not speculative abstraction; interfaces alone are not a sandbox. |
| D-014 | Provider plugins own model runtime loading, tokenizers, prompt preparation, multimodal preprocessing and inference. | The same model-card/plugin pair runs in BML and Aether; BML no longer maintains a second provider engine. |
| D-015 | Headless Node model inference is the primary execution target for local developer workflows; browser/WebGPU remains an optional host. | ArcanAI stays browser-neutral at the core boundary, but BML/browser runtime acceptance is not a dependency for Mac-based Aether file/tool work. |
| D-016 | Provider transport and execution environment are independent of model identity and capability evidence. | Embedded Transformers.js, Ollama, compatible local HTTP services and distinct hosted APIs should remain independent plugins; no vendor-specific switches in core. |
| D-017 | Existing Ollama and owned Transformers.js runtime contracts are retained before adding providers. | Extend provider coverage without replacing the canonical v1.0 card or building a second inference engine inside BML/Aether. |

## Clarifications and rejected scope

- The earlier idea of `install: prompt`, `upgrade: manual`, or auto-install based on card metadata was superseded by **no dependency management in ArcanAI at all**. Do not resurrect it in core, CLI, or card loading without a new explicit decision.
- No automatic provider compatibility health monitoring, API version checks or speculative troubleshooting categories. Forward meaningful status and raw provider error evidence safely when verbose is requested.
- Model card catalog presence, npm install state, explicit registration and service/model reachability are separate concepts. Catalog listing must not trigger network calls or downloads.
- No agent task engine, scheduled job store, marketplace or mandatory universal generic plugin API.
- A model plugin may communicate with a service or execute a local runtime; don't equate adapter, model and engine.

## Implemented decisions and remaining design questions

The code implements v1.0 cards, explicit named registration, a common async event stream with `generate()` collecting it, per-request heartbeat/idle/total supervision, host-selected Node card sources, a native Ollama provider and a Transformers.js provider-owned model loader. These no longer belong in a generic "unimplemented API" list. Check `IMPLEMENTATION-STATUS.md` for verification limits.

The following decisions remain open at the implementation-contract level:

1. Plugin capability and compatibility descriptions (declared support vs observed BML evidence); reject unsupported features rather than silently degrading.
2. Immutable host-policy ceilings, aggregation limits for streamed text/reasoning/diagnostics, and comprehensive sanitization of provider errors and plugin logs.
3. Cross-provider initialization/concurrency/stop/dispose protocol and safe failure recovery without assuming in-process plugins are isolated.
4. Semver/release contracts, historical BML card migration, and real provider/model/device parity.
5. Which HTTP services deserve an OpenAI-compatible adapter versus a vendor-specific provider plugin, with explicit feature and credential boundaries.
6. Real Node CPU/WebGPU support and optional browser WebGPU acceptance per chosen model/revision/quantization/device. Buildability alone isn't proof of execution.

No new automatic package installation, model downloads, retries, hosted orchestration, or SDK-owned tool execution are authorized by these questions.

## Review criteria for future changes

- Can an adapter/provider be replaced without changes to a host or other adapters?
- Are significant model-specific formats and configuration in validated data, rather than source switches?
- Has code accidentally taken over npm/project ownership or Aether's orchestration responsibilities?
- Does the same execution card mean the same thing to BML and other hosts?
- Does a failure report accurately what is observable rather than guess about a provider's internal state?
- Are invariants covered by conformance/contract tests and real evidence rather than just type signatures?
- Are compatibility changes documented with migrations rather than silently rewriting historical data?

See [architecture](ARCHITECTURE.md) and [contracts](CONTRACTS.md) for full details.
