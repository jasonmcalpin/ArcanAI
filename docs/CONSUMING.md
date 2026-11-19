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
