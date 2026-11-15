# ArcanAI architecture

**Status:** accepted design direction; not a claim of implemented functionality. See [contracts](CONTRACTS.md), [decisions](DECISIONS.md), and [README](../README.md).

## Purpose

ArcanAI is a host-independent TypeScript/JavaScript SDK for using model-execution plugins through stable, familiar interfaces. The host invokes models without depending on an individual provider protocol. Plugins translate structured requests and model settings to the actual runtime/service and normalize results. ArcanAI owns the **canonical execution portion of the model-card format** and its interpretation. BML and other hosts consume that same format and the same plugin implementations.

ArcanAI does **not** orchestrate agents, execute host tools, persist or resume jobs, manage benchmarks, install or upgrade npm packages, manage model downloads, run external provider services, or diagnose every provider failure. Plugins may load model assets using their installed runtime and the operator's cache/network policy during explicit initialization. npm/Dependabot/project owners maintain dependencies; hosts (e.g. Aether) own jobs, retries, orchestration, recovery, and persistence. A missing plugin is a clear status/error, not an installation prompt.

## Vocabulary

| Term | Definition |
| --- | --- |
| Host | An application using ArcanAI, e.g. BML or Aether |
| Plugin | Installable adapter implementing versioned ArcanAI execution contract; explicitly registered by host |
| Provider | External service or locally hosted engine accessed by the plugin; some plugins embed the engine |
| Instance | A named, configured registration of a plugin; multiple instances of one plugin are supported |
| Model | A model identifier recognized by the selected provider/instance |
| Model card | Versioned declarative JSON describing model execution requirements and options, owned by ArcanAI |
| Capability | An operation supported by an adapter, initially model generation / streaming; other families require their own contracts |
| Execution | One model invocation, not a whole agent task |
| Diagnostic event | Optional structured record of something the plugin or core did; not proof of provider health |

An *installed* npm package is not necessarily *registered*. A registered instance is not necessarily reachable. A listed card does not imply that the model weights are installed or available. A heartbeat from ArcanAI is not evidence of model progress.

## Responsibility matrix

| Responsibility | Owner |
| --- | --- |
| Public generation interface, card validation, plugin registration/dispatch, standardized status/events and cancellation propagation | ArcanAI core |
| Provider wire format, model runtime loading/initialization, tokenizer and prompt formatting, multimodal preprocessing, provider options, response parsing, provider-specific errors, owned resource cleanup | Plugin |
| Registered instances, credentials, instance configuration, logging policy, execution limits, selecting a model/card | Host / deployment owner |
| Agent loops, scheduling, tooling, long-lived tasks, checkpoint/resume, retry policy, task liveness | Host (e.g. Aether) |
| Benchmark evaluation, scoring, run artifacts, qualification measurements | BML |
| npm dependency installation/upgrades, model/service installation, security patch workflow | Project owner and existing tools |

## Logical dataflow

```text
Host (BML / Aether / other)
    | structured messages + card + per-call settings
    v
ArcanAI SDK
    | validate card/request; resolve explicit instance;
    | merge options; enforce host limits; dispatch;
    | emit status/progress/diagnostic events
    v
Plugin instance (e.g., Ollama, OpenAI, llama.cpp, Transformers)
    | validate providerOptions; render/translate;
    | call provider; normalize outputs/errors
    v
Provider / model runtime
```

The return path contains a normalized result or structured failure, optional streaming events, and optional diagnostics. No implicit tool execution or agent loop happens in ArcanAI.

## Primary architecture invariants

1. **Explicit registration.** Merely installing a package or adding a model card cannot cause its code to load, register, or execute. Host chooses plugin factories and instances.
2. **No dependency management.** ArcanAI never invokes npm, installs/upgrades/removes packages, modifies lockfiles, downloads weights, or auto-starts services to satisfy cards. Report missing requirements and let project owner act.
3. **One execution schema.** ArcanAI owns a single versioned model-execution card schema and validator. BML uses it unchanged; any benchmark-specific data is owned separately and must not redefine execution semantics.
4. **Plugin independence.** No BML, Aether, Pantheon, or Taro imports in ArcanAI core or provider plugins. Hosts depend on public contracts. Provider-specific settings/translation do not enter core.
5. **Separation of time scales.** ArcanAI supervises a single model call; hosts own durable jobs, retries, checkpoints, and orchestration. No implicit replay after partial or ambiguous failures.
6. **Single terminal outcome.** An execution reaches exactly one terminal outcome, including on cancellation/timeout/disconnect, despite late provider events. Provider-side cancellation may be best-effort.
7. **Information preservation.** Unrepresentable required features produce explicit errors, not silent loss. Preserve usable provider metadata/error context without requiring a universal error taxonomy.
8. **Diagnostics are observational.** Off by default for production. Verbose/trace emit actionable sanitized events without changing request interpretation or causing logging failures to fail inference.
9. **Trust is explicit.** Cards are untrusted declarative data. npm plugins execute with host privileges unless explicitly isolated; registration is **not** a sandbox.
10. **Modularity by independent decisions.** Registry, card validation, plugin translation, and diagnostics can change without rewriting one another. Avoid unnecessary speculative layers.

## Registration and model identity

The same plugin implementation can be registered more than once, e.g. three named Ollama instances for different machines. A card refers to a plugin requirement and an instance selector/configuration; the host must explicitly register that instance. Provider identity, deployment identity and model identity must never be collapsed into one string.

Card discovery may list model configurations whether or not their provider can run. Reading cards and resolving registrations must not perform inference, contact every endpoint, or install dependencies.

## Configuration ownership and precedence

- Plugin defaults define protocol behavior; the host configures endpoint/credentials, limits and defaults for each instance; the model card defines execution defaults; an individual request may override eligible settings.
- Provisional precedence for ordinary generation settings: plugin defaults < instance defaults < card defaults < request overrides, **subject to mandatory host policy and hard limits**. This order must be ratified and tested with the contract/schema implementation.
- Common options have portable semantics where feasible; provider-specific `providerOptions` are opaque to core but validated and interpreted by the selected plugin. Conflicts cannot be silently ignored.
- Cards contain only declarative data (no code evaluation), and never embed secrets. Host owns credential injection.
- Model-specific prompt templates, adapter mapping, sampling settings, and protocol templates belong in cards or provider-owned data, not BML or core source switches.

## Execution and observability

One underlying execution path supplies a convenience `generate()` result and event-based `stream()` surface. A provider that cannot stream can emit a final completion. Tool calls are structured model outputs; executing tools is a host responsibility.

The core supervises deadlines, cancellation and observable status. Plugins emit true provider progress/output where available. Heartbeats report supervisor liveness only. An event-loop freeze cannot be detected by a heartbeat running on the same blocked event loop; hard process/hang detection requires out-of-process supervision and is not promised by this library.

Errors are normalized into a small terminal status vocabulary plus source/code/message and redacted raw provider details in verbose diagnostics. No automatic upgrade checks, compatibility probing on every request, hidden retries, background health polling, or broad attempt to classify provider failures.

## Boundaries for future extension

A tooling/MCP/storage provider may eventually use the registration/lifecycle infrastructure but should have a dedicated capability contract, not be forced through model-generation messages. A plugin-discovery mechanism can be added later as opt-in, without weakening explicit registration defaults. Packaging and distribution are delegated to npm and project owners.

## Trust and operations

Validate cards and requests and bound event buffers. Treat secrets, payloads, provider errors and logs as sensitive; redaction is mandatory before passing data to diagnostic sinks. Do not promise isolation for third-party packages imported in-process. Hosts configure policies/limits and decide whether to allow plugins. Provider-specific concurrency limits and resource cleanup belong to plugin contracts; ArcanAI enforces declared constraints where applicable.

## Acceptance criteria for first implementation

- Two named instances of one plugin work without conflating configuration or models.
- A card invoking a missing/unregistered plugin fails clearly without installing or loading anything.
- BML and a second host resolve the same card and plugin version to equivalent execution settings.
- Streaming and non-streaming paths agree on terminal result and tool-call representation.
- Timeout, cancellation, provider error, disconnect and late completion have consistent outcomes and no implicit retry.
- Verbose output can narrate preparation, send, receive, parse and failure with request ID, but `off` avoids payload capture.
- A provider-specific option is accepted/validated by its plugin without modifying ArcanAI core.
- Shared plugin contract tests verify these guarantees for independent adapters.

## Runtime and multimodal ownership

The provider plugin must own its model runtime adapter, initialization, tokenizer, prompt processing, supported content-part translation, image preprocessing, inference, and disposal. BML must not maintain separate model-family loaders or multimodal processors. Its benchmark inputs/fixtures/scoring and evidence remain BML-owned. Aether later consumes the same plugin and canonical card, independently of BML.

The first Transformers.js plugin supports a declarative runtime specification (`kind`, `modelClass`, `processorClass`, `dtype`, `revision`, `device`, and optional image preprocessing settings). Configuration is validated as card data; no model-name-specific source switches are allowed. The optional injected runtime port remains for migration/testing; production hosts should use `loadTransformersJsInstance(card)`.

The current multimodal contract supports typed text and image URL parts; the Transformers.js plugin validates a single image/user prompt until richer combinations are explicitly supported. Other plugins must reject unsupported inputs rather than flattening images into text.
