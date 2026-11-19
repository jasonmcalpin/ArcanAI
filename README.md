# ArcanAI

**Host-independent model inference through explicitly registered, replaceable provider plugins.**

**Status:** An implemented but unpublished TypeScript/JavaScript SDK with a canonical execution-card schema, `generate()` / `stream()`, supervision, an Ollama provider plugin, and a Transformers.js provider plugin with an owned loader. Those capabilities have automated tests; this is **not** evidence that every supported model, device, browser, or provider has been runtime-qualified. See [implementation status](docs/IMPLEMENTATION-STATUS.md).

## Destination

ArcanAI is the model-execution layer for Aether, Browser Model Lab (BML), and other applications. It normalizes **one inference invocation**, not an agent task. A host supplies the model card and explicitly registered provider instance; the plugin owns its provider protocol or embedded model runtime.

```text
Aether / BML / application
      │ reviewed model execution card + messages + invocation options
      ▼
ArcanAI SDK  —  validation, registration, streaming, cancellation, diagnostics
      │
      ├── Embedded model plugin: Transformers.js (headless Node first)
      ├── Local service plugin: Ollama
      └── Future independent plugins: OpenAI-compatible HTTP, OpenAI,
          Anthropic, Gemini, and other supported providers
```

**Primary execution target for local agent work:** headless Node.js on the developer's machine (macOS first), using small models through Transformers.js or models exposed by a locally running Ollama service. The browser-neutral core and possible browser/WebGPU inference remain useful for BML and web applications, but a browser runtime is **not required for Aether's file and tool workflows**. Node/CPU and Node/WebGPU model support depend on the installed runtime, model and actual hardware; browser support is not inferred from TypeScript compatibility.

A model provider can be embedded, local over HTTP, or remote. Environment (Node/browser), transport, backend, model identity, requested capabilities and host policy are different concerns. Plugins own protocol translation, supported modalities, initialization and cleanup. A new provider should not require provider-name switches in ArcanAI core.

## Implemented interfaces and plugins

- **Core:** `createArcanAI()`, explicit `register({ id, plugin, defaults? })`, `generate({ card, messages, ... })`, `stream({ card, messages, ... })`. `card` is a **validated execution-card object**, not an automatically looked-up card ID.
- **Cards:** `parseModelCard()` and host-selected Node `readModelCards({ root, path })` through `arcanai/node/cards`; browser hosts load JSON through their own asset mechanism.
- **Ollama:** `arcanai/plugins/ollama` uses native Ollama `/api/chat` streaming. The host must start/configure Ollama and provide its endpoint.
- **Transformers.js:** `arcanai/plugins/transformersjs` provides `loadTransformersJsInstance(card)`, model initialization, supported runtime profiles, inference and disposal. Model asset loading follows the installed Transformers.js runtime's configuration; ArcanAI is not a dependency/model installer.

```ts
import { createArcanAI, parseModelCard } from "arcanai";
import { ollamaPlugin } from "arcanai/plugins/ollama";

const runtime = createArcanAI("off");
runtime.register({
  id: "mac-ollama",
  plugin: ollamaPlugin({ endpoint: "http://127.0.0.1:11434" })
});
const card = parseModelCard({
  schemaVersion: "1.0",
  id: "my-model",
  execution: {
    plugin: "@arcanai/plugin-ollama",
    instance: "mac-ollama",
    model: "qwen3:4b",
    options: { maxTokens: 256 }
  }
});
const result = await runtime.generate({
  card,
  messages: [{ role: "user", content: "Hello" }]
});
```

This example presumes the specified model is available in the host's Ollama instance. The project does not provision it.

## Ownership and explicit exclusions

- **ArcanAI:** model-card execution semantics, registered providers, generation/streaming events, cancellation propagation and diagnostics.
- **Provider plugins:** provider options, protocols, model runtime loading/tokenization/preprocessing, availability and owned resource cleanup.
- **Aether:** agent/tool loops, file access, subprocesses, skills, permissions, run persistence and recovery.
- **Pantheon:** task planning, scheduling, model selection policy, approval, verification and completion.
- **BML:** model qualification, scoring, benchmark artifacts and measured capability evidence.

ArcanAI does **not** install packages, install/start models or services, auto-register plugins, retry ambiguous provider requests, manage durable agent jobs, execute model-requested tools, or provide an OS sandbox. Cards are data, not executable instructions or permissions.

Support for OpenAI-compatible local HTTP servers and direct OpenAI/Anthropic/Gemini APIs is a **planned plugin direction**, not a feature available from the current package. Consumer ChatGPT/Claude subscriptions must not be assumed to authorize use of the corresponding provider APIs. In browsers, provider secrets must remain outside client bundles.

## Development and reference documents

```sh
npm ci
npm run build
npm test
```

- [Architecture and roadmap](docs/ARCHITECTURE.md)
- [Public and plugin contracts](docs/CONTRACTS.md)
- [Accepted decisions](docs/DECISIONS.md)
- [Implemented vs planned capabilities](docs/IMPLEMENTATION-STATUS.md)
- [Consuming from another project](docs/CONSUMING.md)
- [Engineering guidance](docs/ENGINEERING-GUIDANCE.md)

The same canonical execution cards and provider plugins should serve BML, Aether and future hosts. Hosts choose where cards live; no default `models/` or `testing/` directory is imposed by ArcanAI.
