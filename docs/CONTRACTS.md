# ArcanAI public and plugin contracts

**Status:** A public v1.0 execution-card and plugin API are implemented, but this document also contains forward-looking contract sketches. Use `src/types.ts`, `src/core.ts`, `src/cards.ts`, and provider implementations for the current wire/API truth; see `IMPLEMENTATION-STATUS.md`. ArcanAI packages are not published.

## Public developer experience

Use familiar OpenAI-style `messages` (`role` and `content`), Vercel-style provider separation and `providerOptions`, and typed output/events capable of richer Responses-style content. Do **not** claim full OpenAI API compatibility; adapters must preserve supported semantics and reject unsupported required features.

```ts
import { createArcanAI, parseModelCard } from "arcanai";
import { ollamaPlugin } from "arcanai/plugins/ollama";

// Implemented API: registration is explicit and separate from card discovery.
const runtime = createArcanAI("off");
runtime.register({
  id: "mac-ollama",
  plugin: ollamaPlugin({ endpoint: "http://127.0.0.1:11434" })
});

const card = parseModelCard({
  schemaVersion: "1.0",
  id: "local-chat",
  execution: {
    plugin: "@arcanai/plugin-ollama",
    instance: "mac-ollama",
    model: "qwen3:4b",
    options: { maxTokens: 512 },
    providerOptions: { num_ctx: 8192 }
  }
});
const messages = [{ role: "user" as const, content: "Hello" }];
const result = await runtime.generate({ card, messages });
for await (const event of runtime.stream({ card, messages })) {
  // text/reasoning deltas, structured tool-call output and a terminal result
}
```

The code above matches the current public API. The chosen model and Ollama service must already be available; this is not a verified live-model smoke test.

## Canonical model execution cards

ArcanAI defines and versions the **execution** schema and validation. JSON cards can be stored in directories. A card declares a plugin package requirement and execution options, never runs installation or executable code. BML must consume this same execution section; BML-specific benchmark metadata can live adjacent, by composition, but must not change its meaning.

Illustrative structure:

```json
{
  "schemaVersion": "1.0",
  "id": "qwen3-8b",
  "execution": {
    "plugin": "@arcanai/plugin-ollama",
    "instance": "mini-server",
    "model": "qwen3:8b",
    "options": { "temperature": 0.7, "maxTokens": 512 },
    "providerOptions": { "num_ctx": 8192 }
  }
}
```

The published version contract is not finalized. The current runtime parses `schemaVersion: "1.0"` and accepts `execution.plugin`, `execution.model`, an optional instance, common options, provider options and optional `runtime`/`profile` JSON. The current `parseModelCard()` implementation does **not** enforce a `pluginVersion` compatibility field. The instance may be supplied in the request or card; the runtime still requires a matching explicitly registered instance. Existing BML cards and historical run artifacts should be migrated without rewriting old evidence in place.

**Missing plugin behavior:** if the required plugin is not registered, return `status: "unavailable"` with code `PLUGIN_NOT_FOUND`, required package and card identifier. Do not install, suggest an executable installation workflow, upgrade, or auto-register a package. Host/developer handles it. Installed-but-unregistered remains unavailable.

## Configuration contract

| Layer | Owner | Meaning |
| --- | --- | --- |
| Plugin defaults | Plugin | Protocol-aware defaults |
| Instance defaults | Host | Endpoint, credentials, deployment-specific policy and options |
| Card execution settings | ArcanAI schema; values authored by card owner | Reusable model-level settings, mappings, templates |
| Request overrides | Caller | Per-invocation settings |
| Mandatory limits | Host | Policy constraints cannot be overridden |

Proposed precedence of eligible generation settings is plugin < instance < card < request; host ceilings/policy always win. Do not merge secrets into cards or diagnostics. Core validates common fields and passes provider-specific settings to the selected plugin for schema validation. Unsupported common features and duplicate/conflicting common/provider options must be reported explicitly rather than silently discarded. A model can be identified by card and/or explicit model request, with mismatch rules specified before implementation.

Requested, resolved and *provider-confirmed* options must remain distinguishable in verbose diagnostics; forwarding a setting does not prove provider honored it.

### Actual implementation versus deferred host policy

Current core merges **instance defaults → card → request** for supported common options and JSON `providerOptions`; plugin defaults are provider-owned rather than a global core merge layer. `GenerateRequest` does not yet expose a fully enforced, non-overridable host ceiling contract. Provider adapters validate recognized protocol options, but forwarding an option is not proof that the provider honored it. Host policy, compatibility negotiation and feature declarations are future changes requiring tests and explicit API/version decisions.

Node hosts use `readModelCards({ root, path })` from `arcanai/node/cards`; browser hosts supply card objects from their own asset-loading boundary. No global model directory is assumed.

## Plugin identity, registration and lifecycle

```ts
interface PluginManifest {
  id: string;                    // package/implementation identity
  contractVersion: string;       // compatible ArcanAI contract range
  capabilities: string[];        // e.g. "model.generate"
}
interface PluginContext {
  log(level: "debug" | "info" | "warn" | "error",
      message: string, data?: Record<string, unknown>): void;
}
interface ExecutionContext extends PluginContext {
  signal: AbortSignal;
  emit(event: ExecutionEvent): void;
  executionId: string;
}
interface ModelPlugin {
  manifest: PluginManifest;
  start?(context: PluginContext): Promise<void>;
  execute(request: ModelRequest, context: ExecutionContext):
    Promise<ModelResult> | AsyncIterable<ExecutionEvent>;
  stop?(): Promise<void>;
}
```

This is a **semantic sketch**; the final interface should use one canonical execution/event strategy rather than require plugin authors to implement separate code paths for streaming and non-streaming. Suggested canonical execution: async event stream; `generate()` collects it and `stream()` exposes it. Non-streaming providers can emit a completion event. Event transport and last-result ownership need precise typing/conformance tests.

An instance is registered explicitly and may have independently owned resources. Registration must not contact providers. `start` initializes optional resources; `stop` drains/cancels in-flight requests according to host policy and releases owned resources. Startup/stop idempotence, concurrency and error behavior must be verified. No package scanning, activation from card content, or installation.

**Current TypeScript interface:** `ModelPlugin` has an `id` and at least one of `stream(request, context)` or `execute(request, context)`, with optional `start()`/`stop()`; `ArcanAI.register({ id, plugin, defaults? })` accepts it without a manifest or automatic lifecycle activation. The following manifest-rich sketch is a **future capability/compatibility proposal**, not a currently required plugin shape. Explicit lifecycle negotiation and portable capability declarations are unimplemented.

## Execution result and event semantics

Normalized terminal statuses: `success`, `error`, `timeout`, `cancelled`, `unavailable`. A failure may contain `code`, sanitized `message`, provider status/code, and optional details. Raw provider diagnostics may be exposed only when enabled and sanitized. A connection loss does not prove the remote operation stopped, nor does cancellation prove termination.

Execution events should represent:
- accepted/started; model output text delta or structured content; tool-call arguments/results **as model output only**; provider progress if available; warnings; terminal completion/failure
- optional heartbeat (supervisor alive, not model progress) and diagnostic/log event
- monotonically ordered per execution with `executionId`, a single authoritative terminal state, no events changing state after terminal

A host should be able to observe a request without adopting streaming. A plugin error or malformed output cannot make a second terminal state. Abandoned or slow streams require bounded buffering/backpressure and cancellation/cleanup rules.

## Deadlines, cancellation, failures

Deadline types under consideration:
- connection deadline (establish provider connection)
- inactivity deadline (no **provider** activity; core heartbeats do not reset)
- total execution deadline

Values and behavior are caller/host policy, not a hard-coded RP-versus-coding timeout. An idle threshold may warn instead of aborting; absence of tokens alone is not proof of a hung model. The host owns long-lived task liveness. In-process heartbeats cannot diagnose a blocked JS event loop.

No automatic resubmission, retries, upgrades or compatibility probes. Preserve provider error codes/messages where safe. Plugin is responsible for provider request cancellation where supported and releasing local resources. Host decides retries and recovery. An ambiguous remote completion remains explicitly ambiguous.

## Diagnostics contract

Diagnostic levels:
- `off` (production default): status, normal results, concise errors; **no unnecessary diagnostic payload collection**
- `basic`: instance/plugin/model, timing, optional usage
- `verbose`: structured log of preparation, settings resolution, request dispatch, response received, parse, failures and sanitized provider evidence
- `trace`: finer protocol/stream detail only if supported and allowed by host security policy

Events have `executionId`, timestamp, source, level, message and optional sanitized data. Plugins use `context.log(...)`; core controls collection and sinks. Logging must never affect the result or throw into inference. Host maximum diagnostic policy overrides per-request requests. Capturing full prompts, outputs or provider payloads may expose sensitive data: redaction and opt-in payload capture are required, not merely verbose level. Verbose is not a guarantee every provider exposes effective settings or progress.

## Concurrency and conformance

Providers can impose limits on parallel requests and instances. Define and enforce a declared maximum/in-flight policy, rather than allowing a plugin to corrupt shared model state. Keep host-wide scheduling out of ArcanAI.

A common conformance suite should cover: explicit registration, multiple instances, card validation/version errors, absent plugin, options passthrough/conflict, output/tool-call fidelity, stream ordering, slow consumer/abort, timeout, disconnect, late events, one terminal result, resource cleanup, and redaction. Distinguish what was tested from what is only specified.

## Canonical model execution profiles

For Transformers.js, the canonical ArcanAI card owns independent `execution.runtime` (model loader, revision, dtype, processor and device) and `execution.profile` (declarative chat placement, tool protocol, reasoning controls and workload settings). These are validated JSON-owned sections, not duplicate copies of the same runtime spec.

`prepareModelInvocationFromCard(card, request)`, `prepareVisionInvocationFromCard(card, imageUrl, prompt, budget)` and `parseModelOutputFromCard(card, raw)` are provider-owned helpers shared by BML and Aether. They do not import benchmark fixture/scorer concepts. A host may use these helpers to construct an invocation for a chosen workload; they are not separate BML engines.

BML v3 cards can be migrated into this schema without changing benchmark evidence. Existing benchmark-specific fields remain BML-owned. A card's presence never installs packages, model weights or services.

## Host-selected model card sources

Card paths belong to the consuming host, **not** to ArcanAI's plugin, a model card, or a global default. Node hosts may provide `{ root, path }` to `readModelCards` to read canonical cards, or to `readCardFilesSync` when migrating a legacy card schema. `path` may select a JSON file or a directory within the explicit `root`. No model is executed or provider registered by these operations.

```ts
import { readModelCards } from "arcanai/node/cards";
const cards = await readModelCards({ root: projectRoot, path: "models" });
// BML can select "testing", Aether "models", etc.
```

In browser contexts, the host imports/fetches its configured assets or manifests and calls `parseModelCard` on their JSON values; ArcanAI does not attempt to access the host filesystem or embed the build system's directory conventions. Paths are source-location policy only, and never become model execution identity. A host is responsible for selecting the files and versioning its inventory.

For migration from BML's legacy v3 cards, `readCardFilesSync({root,path})` returns undecorated JSON values and their paths; the BML host must validate the legacy shape and translate the execution portion to the canonical ArcanAI card. Do not treat arbitrary legacy JSON as validated canonical execution data.

The Node loader rejects root traversal, selected-folder symlinks, and symlinked JSON files. An empty folder returns an empty inventory; requiring nonempty inventories is a host policy. This helper does not install dependencies or discover/register plugins.
