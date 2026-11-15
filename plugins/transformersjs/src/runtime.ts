import type { ExecutionCard, JsonRecord, ModelPlugin } from "arcanai";
import { transformersJsPlugin, TransformersPluginError, type TransformersModelRuntime } from "./index.js";

type SDK = typeof import("@huggingface/transformers");
type Progress = (value: { status?: string; file?: string; loaded?: number }) => void;

export interface LoadedTransformersRuntime extends TransformersModelRuntime {
  readonly tokenizer: unknown;
  readonly templateSource?: string;
  renderPrompt(messages: readonly { role: string; content: string }[], tokenizerOptions?: Readonly<Record<string, unknown>>): string;
  dispose(): Promise<void>;
}

export interface LoadedTransformersInstance {
  readonly plugin: ModelPlugin;
  readonly runtime: LoadedTransformersRuntime;
  readonly stoppingCriteria: { interrupt(): void; reset(): void };
  dispose(): Promise<void>;
}

export interface TransformersLoadOptions {
  onProgress?: Progress;
  /** Supplying an SDK is useful for controlled tests; normal use imports Transformers.js. */
  sdk?: SDK;
}

type RuntimeSpec = {
  kind: "pipeline" | "direct-model";
  revision: string;
  dtype: string | Record<string, string>;
  modelClass?: "Qwen3_5ForConditionalGeneration" | "AutoModelForCausalLM";
  processorClass?: "AutoProcessor";
  renderer?: "tokenizer-template" | "message-format";
  messageFormat?: Record<string, string>;
  device: "webgpu" | "cpu";
  imageSize: { width: number; height: number };
};

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new TransformersPluginError("INVALID_RUNTIME", `${name} must be a string`);
  return value;
}
function dict(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function resolveSpec(input: JsonRecord | undefined): RuntimeSpec {
  if (!dict(input)) throw new TransformersPluginError("INVALID_RUNTIME", "card.execution.runtime is required for local model loading");
  const kind = input.kind;
  if (kind !== "pipeline" && kind !== "direct-model") throw new TransformersPluginError("INVALID_RUNTIME", "runtime.kind must be pipeline or direct-model");
  const revision = text(input.revision, "runtime.revision");
  const dtype = input.dtype;
  if (!(typeof dtype === "string" || (dict(dtype) && Object.values(dtype).every(v => typeof v === "string")))) {
    throw new TransformersPluginError("INVALID_RUNTIME", "runtime.dtype must be a string or precision map");
  }
  const device = input.device ?? "webgpu";
  if (device !== "webgpu" && device !== "cpu") throw new TransformersPluginError("INVALID_RUNTIME", "runtime.device is unsupported");
  const modelClass = input.modelClass;
  if (modelClass !== undefined && modelClass !== "Qwen3_5ForConditionalGeneration" && modelClass !== "AutoModelForCausalLM") {
    throw new TransformersPluginError("INVALID_RUNTIME", "unsupported runtime.modelClass");
  }
  const processorClass = input.processorClass;
  if (processorClass !== undefined && processorClass !== "AutoProcessor") throw new TransformersPluginError("INVALID_RUNTIME", "unsupported runtime.processorClass");
  const renderer = input.renderer;
  if (renderer !== undefined && renderer !== "message-format" && renderer !== "tokenizer-template") {
    throw new TransformersPluginError("INVALID_RUNTIME", "unsupported runtime.renderer");
  }
  if (renderer === "message-format" && !dict(input.messageFormat)) {
    throw new TransformersPluginError("INVALID_RUNTIME", "message-format renderer needs a declarative messageFormat");
  }
  const size = dict(input.imageSize) ? input.imageSize : {};
  const width = size.width ?? 448, height = size.height ?? 448;
  if (![width, height].every(n => typeof n === "number" && Number.isSafeInteger(n) && n >= 1 && n <= 4096)) {
    throw new TransformersPluginError("INVALID_RUNTIME", "imageSize dimensions must be 1..4096");
  }
  return { kind, revision, dtype: dtype as string | Record<string, string>, device,
    ...(modelClass ? { modelClass } : {}), ...(processorClass ? { processorClass } : {}),
    ...(renderer ? { renderer } : {}),
    ...(input.messageFormat && dict(input.messageFormat) ? { messageFormat: input.messageFormat as Record<string, string> } : {}),
    imageSize: { width: width as number, height: height as number } } as RuntimeSpec;
}

function source(tokenizer: any): string | undefined {
  const value = tokenizer?.chat_template;
  if (value === undefined || value === null) return undefined;
  return typeof value === "string" ? value : JSON.stringify(value);
}
function template(tokenizer: any, messages: readonly { role: string; content: string }[],
  extra: Readonly<Record<string, unknown>> = {}): string {
  if (typeof tokenizer?.apply_chat_template !== "function") {
    throw new TransformersPluginError("UNSUPPORTED_RUNTIME", "tokenizer has no apply_chat_template");
  }
  const value = tokenizer.apply_chat_template(messages, { ...extra, add_generation_prompt: true, tokenize: false });
  return typeof value === "string" ? value : JSON.stringify(value);
}
function formatted(messages: readonly { role: string; content: string }[], format: Record<string, string>): string {
  const values: string[] = [];
  if (format.defaultSystemMessage) values.push((format.systemPrefix ?? "") + format.defaultSystemMessage);
  for (const message of messages) {
    const prefix = message.role === "system" ? format.systemPrefix
      : message.role === "assistant" ? format.assistantPrefix
      : message.role === "tool" ? format.toolPrefix : format.userPrefix;
    values.push((prefix ?? "") + message.content);
  }
  return values.join(format.separator ?? "") + (format.separator ?? "") + (format.generationSuffix ?? "");
}

/**
 * Load model weights and model-specific preprocessing inside the provider plugin.
 * Aether and BML both consume this factory; neither needs to implement a loader.
 * The project owner installs Transformers.js and chooses/cache-configures models.
 */
export async function loadTransformersJsInstance(
  card: ExecutionCard, options: TransformersLoadOptions = {}
): Promise<LoadedTransformersInstance> {
  if (card.execution.plugin !== "@arcanai/plugin-transformersjs") {
    throw new TransformersPluginError("INVALID_RUNTIME", "card requires another provider plugin");
  }
  const config = resolveSpec(card.execution.runtime);
  const sdk: any = options.sdk ?? await import("@huggingface/transformers");
  const progress_callback = options.onProgress ?? (() => undefined);
  const modelId = card.execution.model;
  const revision = config.revision;
  let runtime: LoadedTransformersRuntime;
  if (config.kind === "pipeline") {
    if (typeof config.dtype !== "string") throw new TransformersPluginError("INVALID_RUNTIME", "pipeline requires scalar dtype");
    const pipeline = await sdk.pipeline("text-generation", modelId, {
      device: config.device, dtype: config.dtype, revision, progress_callback
    });
    runtime = {
      tokenizer: pipeline.tokenizer,
      get templateSource() { return source(pipeline.tokenizer); },
      renderPrompt(messages, tokenizerOptions) { return template(pipeline.tokenizer, messages, tokenizerOptions); },
      generate(messages, generationOptions) { return pipeline(messages, generationOptions); },
      dispose() { return pipeline.dispose(); }
    };
  } else if (config.modelClass === "AutoModelForCausalLM" && config.renderer === "message-format") {
    const tokenizer = await sdk.AutoTokenizer.from_pretrained(modelId, { revision, progress_callback });
    const model = await sdk.AutoModelForCausalLM.from_pretrained(modelId, {
      revision, device: config.device, dtype: config.dtype, progress_callback
    });
    const format = config.messageFormat!;
    runtime = {
      tokenizer,
      templateSource: "declarative-message-format",
      renderPrompt(messages) { return formatted(messages, format); },
      async generate(messages, generationOptions) {
        const encoded = await tokenizer(formatted(messages, format), { add_special_tokens: false, return_attention_mask: true });
        return model.generate({ ...encoded, ...generationOptions });
      },
      async dispose() { await model.dispose?.(); }
    };
  } else if (config.modelClass === "Qwen3_5ForConditionalGeneration" && config.processorClass === "AutoProcessor") {
    if (!sdk.AutoProcessor || !sdk.Qwen3_5ForConditionalGeneration || !sdk.RawImage) {
      throw new TransformersPluginError("UNSUPPORTED_RUNTIME", "requested processor/model/image class is not available in Transformers.js");
    }
    const processor = await sdk.AutoProcessor.from_pretrained(modelId, { revision, progress_callback });
    const model = await sdk.Qwen3_5ForConditionalGeneration.from_pretrained(modelId, {
      revision, device: config.device, dtype: config.dtype, progress_callback
    });
    runtime = {
      tokenizer: processor.tokenizer,
      get templateSource() { return source(processor.tokenizer); },
      renderPrompt(messages, tokenizerOptions) {
        const result = processor.apply_chat_template(messages, { ...tokenizerOptions, add_generation_prompt: true, tokenize: false });
        return typeof result === "string" ? result : JSON.stringify(result);
      },
      async generate(messages, generationOptions) {
        const formattedText = processor.apply_chat_template(messages, { add_generation_prompt: true });
        const inputs = await processor(formattedText);
        return model.generate({ ...inputs, ...generationOptions });
      },
      async generateVision(imageUrl, prompt, generationOptions) {
        const image = await (await sdk.RawImage.read(imageUrl)).resize(config.imageSize.width, config.imageSize.height);
        const conversation = [{ role: "user", content: [{ type: "image" }, { type: "text", text: prompt }] }];
        const formattedText = processor.apply_chat_template(conversation, { add_generation_prompt: true });
        const inputs = await processor(formattedText, image);
        return model.generate({ ...inputs, ...generationOptions });
      },
      async dispose() { await model.dispose?.(); }
    };
  } else {
    throw new TransformersPluginError("UNSUPPORTED_RUNTIME", "unsupported declarative Transformers.js runtime profile");
  }

  const stoppingCriteria = new sdk.InterruptableStoppingCriteria();
  return {
    runtime,
    stoppingCriteria,
    plugin: transformersJsPlugin({
      runtime, stoppingCriteria,
      createStreamer({ onText, onToken }) {
        return new sdk.TextStreamer(runtime.tokenizer, {
          skip_prompt: true, skip_special_tokens: true,
          callback_function: onText, token_callback_function: onToken
        });
      }
    }),
    dispose() { return runtime.dispose(); }
  };
}
