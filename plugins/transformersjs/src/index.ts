import type { JsonRecord, ModelPlugin, PluginExecutionRequest } from "arcanai";

/**
 * Port exposed by a previously initialized Transformers.js model runtime.
 * It deliberately supports BML's pipeline and direct-model implementations
 * without importing BML or knowing individual model families.
 */
export interface TransformersModelRuntime {
  generate(messages: readonly { role: string; content: string }[], options: Record<string, unknown>): Promise<unknown>;
  generateVision?(imageUrl: string, prompt: string, options: Record<string, unknown>): Promise<unknown>;
}

export interface TransformersPluginConfig {
  runtime: TransformersModelRuntime;
  createStreamer(callbacks: {
    onText(text: string): void;
    onToken(): void;
  }): unknown;
  stoppingCriteria?: { reset(): void; interrupt(): void };
}

export class TransformersPluginError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "TransformersPluginError";
  }
}

const ALLOWED = new Set([
  "doSample", "topK", "minP", "presencePenalty", "repetitionPenalty", "tokenizerEncodeOptions"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Translates canonical request settings into Transformers.js generation kwargs.
 * The model-specific chat/tool protocol remains data-driven and is supplied
 * as an already constructed invocation during the BML parity migration.
 */
export function transformersGenerationOptions(request: PluginExecutionRequest): Record<string, unknown> {
  for (const key of Object.keys(request.providerOptions)) {
    if (!ALLOWED.has(key)) throw new TransformersPluginError("UNSUPPORTED_OPTION", `Unsupported Transformers.js option: ${key}`);
  }
  const { maxTokens, temperature, topP } = request.options;
  if (maxTokens === undefined) throw new TransformersPluginError("INVALID_OPTIONS", "maxTokens is required");
  const opts = request.providerOptions;
  if (opts.doSample !== undefined && typeof opts.doSample !== "boolean") throw new TransformersPluginError("INVALID_OPTIONS", "doSample must be boolean");
  for (const name of ["topK", "minP", "presencePenalty", "repetitionPenalty"]) {
    if (opts[name] !== undefined && (typeof opts[name] !== "number" || !Number.isFinite(opts[name]))) {
      throw new TransformersPluginError("INVALID_OPTIONS", `${name} must be finite`);
    }
  }
  if (opts.tokenizerEncodeOptions !== undefined && !isRecord(opts.tokenizerEncodeOptions)) {
    throw new TransformersPluginError("INVALID_OPTIONS", "tokenizerEncodeOptions must be an object");
  }
  return {
    max_new_tokens: maxTokens,
    ...(temperature === undefined ? {} : { temperature }),
    ...(topP === undefined ? {} : { top_p: topP }),
    ...(opts.doSample === undefined ? {} : { do_sample: opts.doSample }),
    ...(opts.topK === undefined ? {} : { top_k: opts.topK }),
    ...(opts.minP === undefined ? {} : { min_p: opts.minP }),
    ...(opts.presencePenalty === undefined ? {} : { presence_penalty: opts.presencePenalty }),
    ...(opts.repetitionPenalty === undefined ? {} : { repetition_penalty: opts.repetitionPenalty }),
    ...(opts.tokenizerEncodeOptions === undefined ? {} : { tokenizer_encode_kwargs: opts.tokenizerEncodeOptions })
  };
}

/**
 * Interpret typed ArcanAI content parts without flattening images into text.
 * The initial Transformers.js vision capability accepts one user image and prompt.
 */
function invocationInput(request: PluginExecutionRequest):
  | { kind: "text"; messages: { role: string; content: string }[] }
  | { kind: "vision"; imageUrl: string; prompt: string } {
  const images: Array<{ imageUrl: string; prompt: string }> = [];
  const messages = request.messages.map(message => {
    if (typeof message.content === "string") return { role: message.role, content: message.content };
    const text = message.content.filter(part => part.type === "text").map(part => part.text).join("");
    const imageParts = message.content.filter(part => part.type === "image");
    if (imageParts.length) {
      if (imageParts.length !== 1 || message.role !== "user") {
        throw new TransformersPluginError("UNSUPPORTED_CONTENT", "vision requires a single user image");
      }
      const source = imageParts[0]!.source;
      images.push({ imageUrl: source.url, prompt: text });
    }
    return { role: message.role, content: text };
  });
  if (!images.length) return { kind: "text", messages };
  if (images.length !== 1 || messages.length !== 1 || !images[0]!.prompt.trim()) {
    throw new TransformersPluginError("UNSUPPORTED_CONTENT", "vision requires one image and one nonempty text prompt");
  }
  return { kind: "vision", ...images[0]! };
}

/**
 * Model-execution adapter shared by pipeline and direct-model runtimes.
 * Initialization and model ownership stay in the provided runtime port for
 * this parity phase, so the native/ArcanAI comparison uses identical weights,
 * tokenizer, stopping criteria and Transformers.js generation machinery.
 */
export function transformersJsPlugin(config: TransformersPluginConfig): ModelPlugin {
  let active = false;
  return {
    id: "@arcanai/plugin-transformersjs",
    async execute(request, context) {
      if (active) throw new TransformersPluginError("INSTANCE_BUSY", "Transformers.js instance is already executing");
      // Validate without mutating the shared runtime state.
      const options = transformersGenerationOptions(request);
      const input = invocationInput(request);
      if (input.kind === "vision" && !config.runtime.generateVision) {
        throw new TransformersPluginError("UNSUPPORTED_CONTENT", "this Transformers.js runtime does not support images");
      }
      if (context.signal.aborted) throw new TransformersPluginError("CANCELLED", "Execution cancelled");

      active = true;
      let raw = "";
      let generatedTokens = 0;
      const start = performance.now();
      let firstTokenMs: number | undefined;
      const onAbort = () => config.stoppingCriteria?.interrupt();
      context.signal.addEventListener("abort", onAbort, { once: true });
      try {
        config.stoppingCriteria?.reset();
        const streamer = config.createStreamer({
          onText(text) { if (!context.signal.aborted) raw += text; },
          onToken() {
            generatedTokens++;
            firstTokenMs ??= performance.now() - start;
          }
        });
        context.log("debug", "provider generation started", { model: request.model });
        const runtimeOptions = {
          ...options,
          streamer,
          ...(config.stoppingCriteria ? { stopping_criteria: [config.stoppingCriteria] } : {})
        };
        if (input.kind === "vision") {
          await config.runtime.generateVision!(input.imageUrl, input.prompt, runtimeOptions);
        } else {
          await config.runtime.generate(input.messages, runtimeOptions);
        }
        if (context.signal.aborted) throw new TransformersPluginError("CANCELLED", "Execution cancelled");
        const generationMs = performance.now() - start;
        const termination = generatedTokens >= request.options.maxTokens! ? "TOKEN_LIMIT" : "UNKNOWN";
        context.log("debug", "provider generation complete", { generatedTokens, generationMs });
        const providerMetadata: JsonRecord = {
          generationMs, generatedTokens,
          tokensPerSecond: generationMs > 0 ? generatedTokens / (generationMs / 1000) : 0,
          termination,
          ...(firstTokenMs === undefined ? {} : { firstTokenMs })
        };
        return { text: raw, finishReason: termination, usage: { outputTokens: generatedTokens }, providerMetadata };
      } finally {
        active = false;
        context.signal.removeEventListener("abort", onAbort);
      }
    }
  };
}
