# Node model-card discovery

ArcanAI core accepts validated model-card objects and is intentionally free of Node filesystem imports. Node applications can opt in to `arcanai/node/cards` to load a directory.

```ts
import { readModelCards } from "arcanai/node/cards";

const entries = await readModelCards("./models");
for (const { path, card } of entries) {
  console.log(path, card.id, card.execution.plugin, card.execution.model);
}
```

The directory is explicitly selected by the host. Only regular `*.json` files in that directory are read; symlinks, subdirectories and non-JSON files are ignored. Cards are returned in a deterministic filename order. Malformed JSON, invalid schemas, and duplicate IDs fail visibly rather than being skipped.

This only catalogs declared model configurations. It does not load the model, inspect Ollama, install plugin packages, resolve npm upgrades, register plugin instances, or claim a service is reachable. The project owner installs dependencies and registers instances explicitly. BML can select a card folder the same way it does today.

See `examples/cards/qwen3-8b-ollama.json` for a sample. Examples are not automatically registered or executed.

For browsers, supply card objects from the application's own asset/data loading mechanism and call `parseModelCard()` directly; importing the core entry point must not pull in `node:fs`.
