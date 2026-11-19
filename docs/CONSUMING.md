# Consume ArcanAI from a separate project

ArcanAI is currently an unpublished npm-format package. Consumers may use a reviewed, pinned GitHub commit until the normal package release process is available.

```sh
pnpm add 'arcanai@github:jasonmcalpin/ArcanAI#<reviewed-commit-sha>'
```

Git-based installation builds the package via its `prepare` script. Project owners remain responsible for dependency installation and upgrades; **ArcanAI never installs its own dependencies in a host application**.

```ts
import { createArcanAI, parseModelCard } from "arcanai";
import { transformersJsPlugin } from "arcanai/plugins/transformersjs";
import { ollamaPlugin } from "arcanai/plugins/ollama";
```

These exports are the public distribution boundary. The plugin package folders remain independently authored, but share this Git distribution until individual versioned registry releases are established. Do not import `dist/src/` paths or reach across into sibling repository checkouts.

A consumer should lock its package manager resolution and track the commit used. ArcanAI's core is browser-neutral and can be bundled for browsers, but browser/WebGPU packaging and real-model inference require independent acceptance; filesystem card enumeration is an explicitly Node-only subpath `arcanai/node/cards`. **Headless Node** Transformers.js inference and Ollama are the primary near-term local execution integrations. Aether owns local file/tool access, not ArcanAI.

This packaging contract is distinct from the runtime contracts: installing the package does not activate a plugin; hosts explicitly register desired instances.

## OpenAI-compatible local HTTP inference

The separately registered `arcanai/plugins/openai-compatible` plugin
implements a bounded subset of `POST /v1/chat/completions` with SSE streaming,
text, structured tool-call output, usage when returned, cancellation and
explicit unsupported-feature errors. A host supplies an explicit
`baseUrl` (for example a compatible `http://127.0.0.1:1234/v1/` server)
and optional credentials. The plugin does **not** install or start the server.

```ts
import { createArcanAI, parseModelCard } from "arcanai";
import { openAICompatiblePlugin } from "arcanai/plugins/openai-compatible";

const arcanai = createArcanAI("off");
arcanai.register({ id: "local-openai-http", plugin: openAICompatiblePlugin({
  baseUrl: "http://127.0.0.1:1234/v1/"
}) });
const card = parseModelCard({ schemaVersion: "1.0", id: "local-http",
  execution: { plugin: "@arcanai/plugin-openai-compatible",
    instance: "local-openai-http", model: "your-served-model" } });
const result = await arcanai.generate({ card,
  messages: [{ role: "user", content: "Hello" }] });
```

Not every OpenAI-style service implements every feature. This provider
deliberately rejects image inputs and unsupported options; model-specific
compatibility, tool correctness and local endpoint readiness require an
independent integration test. Provider keys belong in host configuration,
never model cards or browser JavaScript bundles.

## Headless Node Transformers.js acceptance on macOS

A developer can run a selected, already-compatible Transformers.js model
headlessly in Node with its explicit execution card (no browser):

```sh
npm ci
npm run smoke:node:transformers -- --card /absolute/path/to/card.json --max-tokens 64
```

The selected JSON card must use `@arcanai/plugin-transformersjs` with an
approved `execution.runtime` (`kind`, `model`, `device`,
`dtype`, `revision`). The smoke command invokes the public ArcanAI
`generate()` contract, reports bounded model, runtime, usage, timing,
and completion metadata, and disposes the loaded runtime in `finally`.
It deliberately does not install models or choose an unreviewed fallback,
and will fail if the model/device/weights do not actually work.

CI exercises a deterministic CPU runtime using an injected Transformers
SDK fixture; that is not evidence of real model inference on a Mac.
Hardware qualification must be executed by the developer with a selected
small-model card and the model cache/network policy configured externally.

## Direct OpenAI Responses API

Use `arcanai/plugins/openai` for the provider's **Responses API** rather
than assuming an OpenAI-compatible Chat Completions endpoint has the same
event or tool protocol. The host explicitly supplies a Platform API key;
a ChatGPT consumer subscription is not API authorization.

```ts
import { createArcanAI, parseModelCard } from "arcanai";
import { openAIResponsesPlugin } from "arcanai/plugins/openai";

const arcanai = createArcanAI("off");
arcanai.register({ id: "openai-api", plugin: openAIResponsesPlugin({
  apiKey: process.env.OPENAI_API_KEY!
}) });
const card = parseModelCard({ schemaVersion: "1.0", id: "hosted",
  execution: { plugin: "@arcanai/plugin-openai",
    instance: "openai-api", model: "operator-selected-model" } });
```

This independent provider implements bounded **text-only** Responses SSE
output, structured function-call output, usage, cancellation and explicit
failure for unsupported inputs/options. It defaults to `store: false`.
It does not execute tools or manage API billing. Actual API-key access,
provider latency/model selection and hosted tool-mode conformance remain
operator-configured runtime validation, not CI evidence.

## Direct Anthropic Messages API

`arcanai/plugins/anthropic` is an independent provider mapping the
Anthropic Messages SSE protocol to ArcanAI text/reasoning deltas, native
`tool_use` outputs, usage and termination status. The host supplies the
API key and model ID. Unsupported roles, images and advanced provider
features fail rather than being silently flattened.

```ts
import { anthropicMessagesPlugin } from "arcanai/plugins/anthropic";

const adapter = anthropicMessagesPlugin({ apiKey: process.env.ANTHROPIC_API_KEY! });
// Register `adapter` under an explicit instance ID in createArcanAI().
```

The plugin defaults to the provider's currently documented Messages API
version `2026-10-21`. Real API authorization, pricing/model availability,
capability scope and streaming acceptance are operator-owned, not CI proofs.
Claude consumer subscriptions do not provide API credentials.
