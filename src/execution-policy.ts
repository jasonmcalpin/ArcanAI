import type { ExecutionLimits, GenerateRequest, PluginInstance, GenerationOptions, PluginCapabilities } from "./types.js";

const KEYS: ReadonlyArray<keyof ExecutionLimits> = [
  "maxTokens", "maxOutputBytes", "maxReasoningBytes", "maxToolCalls", "maxDiagnosticEvents"
];
const DEFAULTS: Required<Pick<ExecutionLimits,
  "maxOutputBytes" | "maxReasoningBytes" | "maxToolCalls" | "maxDiagnosticEvents">> = {
  maxOutputBytes: 2 * 1024 * 1024,
  maxReasoningBytes: 512 * 1024,
  maxToolCalls: 128,
  maxDiagnosticEvents: 256
};
function checked(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 128 * 1024 * 1024) {
    throw new TypeError(`execution limit ${name} must be a positive bounded integer`);
  }
  return value as number;
}
export function executionLimits(instance: PluginInstance, request: GenerateRequest): ExecutionLimits {
  const result: ExecutionLimits = { ...DEFAULTS };
  for (const name of KEYS) {
    const parent = checked(instance.limits?.[name], name);
    const child = checked(request.limits?.[name], name);
    if (parent !== undefined && child !== undefined && child > parent)
      throw new TypeError(`request cannot exceed host execution limit ${name}`);
    if (parent !== undefined || child !== undefined) {
      const value = parent === undefined ? child : child === undefined ? parent : Math.min(parent, child);
      if (value !== undefined) result[name] = value;
    }
  }
  return result;
}
export function requireCapabilities(instance: PluginInstance, request: GenerateRequest): string | null {
  const requested = request.requiredCapabilities ?? [];
  if (!Array.isArray(requested) || requested.some(x =>
    !["text", "image", "streaming", "toolCalls"].includes(x))) {
    throw new TypeError("Unknown required model capability");
  }
  if (!requested.length) return null;
  const value = instance.capabilities;
  if (!value || value.schemaVersion !== "1" || !Array.isArray(value.modalities)
    || typeof value.streaming !== "boolean" || typeof value.toolCalls !== "boolean") {
    return "Capability declaration unavailable for registered plugin instance";
  }
  const cap: PluginCapabilities = value;
  for (const item of requested) {
    const supported = item === "streaming" ? cap.streaming
      : item === "toolCalls" ? cap.toolCalls
      : cap.modalities.includes(item);
    if (!supported) return `Unsupported required capability: ${item}`;
  }
  return null;
}
export function enforceTokenLimit(options: GenerationOptions, limits: ExecutionLimits): void {
  if (limits.maxTokens !== undefined && options.maxTokens !== undefined
    && options.maxTokens > limits.maxTokens) {
    throw new TypeError("Effective maxTokens exceeds the host execution limit");
  }
}
