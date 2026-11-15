import type { ExecutionCard, GenerationOptions, JsonRecord, JsonValue } from "./types.js";

export class CardValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CardValidationError";
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CardValidationError(`${path} must be a non-empty string`);
  }
  return value;
}

function json(value: unknown, path: string, depth = 0): asserts value is JsonValue {
  if (depth > 32) throw new CardValidationError(`${path} exceeds maximum nesting depth`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    value.forEach((part, i) => json(part, `${path}[${i}]`, depth + 1));
    return;
  }
  if (object(value)) {
    for (const [key, part] of Object.entries(value)) json(part, `${path}.${key}`, depth + 1);
    return;
  }
  throw new CardValidationError(`${path} must contain JSON-compatible values`);
}

export function validateOptions(value: unknown, path = "options"): GenerationOptions {
  if (value === undefined) return {};
  if (!object(value)) throw new CardValidationError(`${path} must be an object`);
  for (const key of Object.keys(value)) {
    if (!["temperature", "topP", "maxTokens"].includes(key)) {
      throw new CardValidationError(`${path}.${key} is not a common option; use providerOptions`);
    }
  }
  const opts = value as Record<string, unknown>;
  if (opts.temperature !== undefined && (typeof opts.temperature !== "number" || !Number.isFinite(opts.temperature) || opts.temperature < 0)) {
    throw new CardValidationError(`${path}.temperature must be finite and non-negative`);
  }
  if (opts.topP !== undefined && (typeof opts.topP !== "number" || !Number.isFinite(opts.topP) || opts.topP < 0 || opts.topP > 1)) {
    throw new CardValidationError(`${path}.topP must be between 0 and 1`);
  }
  if (opts.maxTokens !== undefined && (typeof opts.maxTokens !== "number" || !Number.isSafeInteger(opts.maxTokens) || opts.maxTokens <= 0)) {
    throw new CardValidationError(`${path}.maxTokens must be a positive integer`);
  }
  return { ...value } as GenerationOptions;
}

export function validateProviderOptions(value: unknown, path = "providerOptions"): JsonRecord {
  if (value === undefined) return {};
  if (!object(value)) throw new CardValidationError(`${path} must be an object`);
  json(value, path);
  return structuredClone(value as JsonRecord);
}

export function parseModelCard(input: unknown): ExecutionCard {
  if (!object(input)) throw new CardValidationError("card must be an object");
  if (input.schemaVersion !== "1.0") throw new CardValidationError("unsupported card schemaVersion");
  const id = string(input.id, "card.id");
  if (!object(input.execution)) throw new CardValidationError("card.execution must be an object");
  const spec = input.execution;
  const plugin = string(spec.plugin, "card.execution.plugin");
  const model = string(spec.model, "card.execution.model");
  const instance = spec.instance === undefined ? undefined : string(spec.instance, "card.execution.instance");
  return {
    schemaVersion: "1.0",
    id,
    execution: {
      plugin,
      ...(instance === undefined ? {} : { instance }),
      model,
      options: validateOptions(spec.options, "card.execution.options"),
      providerOptions: validateProviderOptions(spec.providerOptions, "card.execution.providerOptions"),
      ...(spec.runtime === undefined ? {} : { runtime: validateProviderOptions(spec.runtime, "card.execution.runtime") })
    }
  };
}
