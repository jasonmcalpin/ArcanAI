import { randomUUID } from "node:crypto";
import { parseModelCard, validateOptions, validateProviderOptions } from "./cards.js";
import type {
  DiagnosticEvent, DiagnosticLevel, GenerateRequest, GenerateResult,
  GenerationOptions, JsonRecord, Message, PluginInstance
} from "./types.js";

export class ArcanAI {
  private readonly instances = new Map<string, PluginInstance>();
  constructor(private readonly maxDiagnostics: DiagnosticLevel = "trace") {}

  register(instance: PluginInstance): void {
    if (!instance.id.trim() || !instance.plugin.id.trim()) throw new Error("instance and plugin IDs are required");
    if (this.instances.has(instance.id)) throw new Error(`duplicate instance ID: ${instance.id}`);
    this.instances.set(instance.id, instance);
  }

  listInstances(): ReadonlyArray<{ id: string; plugin: string }> {
    return [...this.instances.values()].map(x => ({ id: x.id, plugin: x.plugin.id }));
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const executionId = randomUUID();
    const card = parseModelCard(request.card);
    const results: DiagnosticEvent[] = [];
    const levels: DiagnosticLevel[] = ["off", "basic", "verbose", "trace"];
    const requestedLevel = request.diagnostics ?? "off";
    const level = levels.indexOf(requestedLevel) <= levels.indexOf(this.maxDiagnostics) ? requestedLevel : this.maxDiagnostics;
    const log = (severity: DiagnosticEvent["level"], source: string, message: string, data?: JsonRecord) => {
      if (level === "off") return;
      if (level === "basic" && severity === "debug") return;
      const event: DiagnosticEvent = { executionId, timestamp: new Date().toISOString(), level: severity, source, message, ...(data ? { data } : {}) };
      results.push(event);
      try { request.onDiagnostic?.(event); } catch { /* observer must never break execution */ }
    };
    const fail = (status: GenerateResult["status"], code: string, message: string): GenerateResult => {
      log("error", "arcanai", message);
      return { executionId, status, error: { code, message }, ...(level !== "off" ? { diagnostics: results } : {}) };
    };

    const instanceId = request.instance ?? card.execution.instance;
    if (!instanceId) return fail("unavailable", "INSTANCE_REQUIRED", "select a registered plugin instance");
    const instance = this.instances.get(instanceId);
    if (!instance || instance.plugin.id !== card.execution.plugin) {
      return fail("unavailable", "PLUGIN_NOT_FOUND", `card ${card.id} requires registered plugin ${card.execution.plugin} at instance ${instanceId}`);
    }
    if (request.signal?.aborted) return fail("cancelled", "CANCELLED", "request cancelled before execution");

    const messages: Message[] = request.messages.map(message => {
      if (!["system", "developer", "user", "assistant", "tool"].includes(message.role) || typeof message.content !== "string") {
        throw new TypeError("invalid message role or content");
      }
      return { ...message };
    });
    const options: GenerationOptions = {
      ...validateOptions(instance.defaults?.options),
      ...validateOptions(card.execution.options),
      ...validateOptions(request.options)
    };
    const providerOptions: JsonRecord = {
      ...validateProviderOptions(instance.defaults?.providerOptions),
      ...validateProviderOptions(card.execution.providerOptions),
      ...validateProviderOptions(request.providerOptions)
    };
    log("info", "arcanai", "request accepted");
    log("debug", instance.plugin.id, "request prepared", { model: card.execution.model });

    const signal = request.signal ?? new AbortController().signal;
    try {
      const response = await instance.plugin.execute(
        { model: card.execution.model, messages, options, providerOptions },
        { executionId, signal, log: (severity, message, data) => log(severity, instance.plugin.id, message, data) }
      );
      if (signal.aborted) return fail("cancelled", "CANCELLED", "request cancelled");
      log("info", "arcanai", "request completed");
      return {
        executionId, status: "success", text: response.text,
        finishReason: response.finishReason, usage: response.usage,
        providerMetadata: response.providerMetadata,
        ...(level !== "off" ? { diagnostics: results } : {})
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "plugin execution failed";
      if (signal.aborted) return fail("cancelled", "CANCELLED", "request cancelled");
      return fail("error", "PLUGIN_ERROR", message);
    }
  }
}

export function createArcanAI(maxDiagnostics: DiagnosticLevel = "trace"): ArcanAI {
  return new ArcanAI(maxDiagnostics);
}
