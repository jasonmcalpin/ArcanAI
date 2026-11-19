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
