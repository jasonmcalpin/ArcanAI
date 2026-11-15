
import { createArcanAI } from "./dist/src/index.js";
import { readModelCards } from "./dist/src/node/cards.js";
import { ollamaPlugin } from "./plugins/ollama/dist/index.js";

// Load model definitions from the card directory.
const entries = await readModelCards("./models");
const card = entries.find(
  ({ card }) => card.id === "qwen3-4b-mac"
)?.card;

if (!card) {
  throw new Error("Model card not found");
}

// Create ArcanAI and explicitly register the provider.
const arcanai = createArcanAI();

arcanai.register({
  id: "mac-m4",
  plugin: ollamaPlugin({
    endpoint: "http://localhost:11434"
  })
});

// Execute the model request.
const result = await arcanai.generate({
  card,
  messages: [
    {
      role: "user",
      content: "Say hello in one sentence."
    }
  ],
  diagnostics: "verbose",
  onDiagnostic(event) {
    console.log(`[${event.source}] ${event.message}`);
  },
  timers: {
    heartbeatMs: 5000,
    idleMs: 120000,
    totalMs: 300000
  }
});

console.log("\nStatus:", result.status);
console.log("Response:", result.text);
console.log("Reasoning:", result.reasoning);
console.log("Usage:", result.usage);

if (result.status !== "success") {
  console.error("Error:", result.error);
  process.exitCode = 1;
}
