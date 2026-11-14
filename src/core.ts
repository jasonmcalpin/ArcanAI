import { randomUUID } from "node:crypto";
import { parseModelCard, validateOptions, validateProviderOptions } from "./cards.js";
import type {
  DiagnosticEvent, DiagnosticLevel, ExecutionEvent, GenerateRequest, GenerateResult,
  GenerationOptions, JsonRecord, Message, PluginExecutionContext, PluginInstance,
  PluginStreamEvent, ToolCall
} from "./types.js";

const LEVELS: DiagnosticLevel[] = ["off", "basic", "verbose", "trace"];

/** Adapt an execute-only plugin into the canonical streamed event lifecycle. */
async function* executeAsStream(
  run: NonNullable<PluginInstance["plugin"]["execute"]>,
  request: Parameters<NonNullable<PluginInstance["plugin"]["execute"]>>[0],
  context: PluginExecutionContext
): AsyncIterable<PluginStreamEvent> {
  const response = await run(request, context);
  if (response.text) yield { type: "text-delta", text: response.text };
  yield {
    type: "completed",
    finishReason: response.finishReason,
    usage: response.usage,
    providerMetadata: response.providerMetadata
  };
}

export class ArcanAI {
  private readonly instances = new Map<string, PluginInstance>();
  constructor(private readonly maxDiagnostics: DiagnosticLevel = "trace") {
    if (!LEVELS.includes(maxDiagnostics)) throw new TypeError("invalid maximum diagnostic level");
  }

  register(instance: PluginInstance): void {
    if (!instance.id.trim() || !instance.plugin.id.trim()) throw new Error("instance and plugin IDs are required");
    if (!instance.plugin.stream && !instance.plugin.execute) {
      throw new Error("plugin must implement stream() or execute()");
    }
    if (this.instances.has(instance.id)) throw new Error(`duplicate instance ID: ${instance.id}`);
    this.instances.set(instance.id, instance);
  }

  listInstances(): ReadonlyArray<{ id: string; plugin: string }> {
    return [...this.instances.values()].map(x => ({ id: x.id, plugin: x.plugin.id }));
  }

  /** generate and stream both use this single underlying execution path. */
  async generate(request: GenerateRequest): Promise<GenerateResult> {
    for await (const event of this.stream(request)) {
      if (event.type === "completed" || event.type === "failed") return event.result;
    }
    // The iterator only ends without a terminal event if a consumer forcibly closes it.
    throw new Error("ArcanAI stream terminated without a result");
  }

  async *stream(request: GenerateRequest): AsyncIterable<ExecutionEvent> {
    const executionId = randomUUID();
    const card = parseModelCard(request.card);
    const diagnostics: DiagnosticEvent[] = [];
    const requestedLevel = request.diagnostics ?? "off";
    if (!LEVELS.includes(requestedLevel)) throw new TypeError("invalid diagnostic level");
    const level = LEVELS[Math.min(LEVELS.indexOf(requestedLevel), LEVELS.indexOf(this.maxDiagnostics))];
    const log = (severity: DiagnosticEvent["level"], source: string, message: string, data?: JsonRecord): void => {
      if (level === "off" || (level === "basic" && severity === "debug")) return;
      const event: DiagnosticEvent = {
        executionId, timestamp: new Date().toISOString(), level: severity, source, message,
        ...(data ? { data } : {})
      };
      diagnostics.push(event);
      try { request.onDiagnostic?.(event); } catch { /* observers cannot affect inference */ }
    };
    const fail = (status: GenerateResult["status"], code: string, message: string): GenerateResult => {
      log("error", "arcanai", message);
      return { executionId, status, error: { code, message }, ...(level !== "off" ? { diagnostics } : {}) };
    };

    const instanceId = request.instance ?? card.execution.instance;
    if (!instanceId) {
      yield { type: "failed", executionId, result: fail("unavailable", "INSTANCE_REQUIRED", "select a registered plugin instance") };
      return;
    }
    const instance = this.instances.get(instanceId);
    if (!instance || instance.plugin.id !== card.execution.plugin) {
      yield {
        type: "failed", executionId,
        result: fail("unavailable", "PLUGIN_NOT_FOUND", `card ${card.id} requires registered plugin ${card.execution.plugin} at instance ${instanceId}`)
      };
      return;
    }

    const controller = new AbortController();
    const abort = () => controller.abort(request.signal?.reason);
    if (request.signal?.aborted) abort();
    else request.signal?.addEventListener("abort", abort, { once: true });
    const signal = controller.signal;
    let completed = false;

    try {
      if (signal.aborted) {
        completed = true;
        yield { type: "failed", executionId, result: fail("cancelled", "CANCELLED", "request cancelled before execution") };
        return;
      }

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
      yield { type: "started", executionId, instance: instanceId, model: card.execution.model };

      const context: PluginExecutionContext = {
        executionId, signal,
        log: (severity, message, data) => log(severity, instance.plugin.id, message, data)
      };
      const pluginRequest = { model: card.execution.model, messages, options, providerOptions };
      const run = instance.plugin.stream
        ? instance.plugin.stream(pluginRequest, context)
        : executeAsStream(instance.plugin.execute!.bind(instance.plugin), pluginRequest, context);

      const parts: string[] = [];
      const calls: ToolCall[] = [];
      let sawCompletion = false;
      for await (const part of run) {
        if (signal.aborted) break;
        if (sawCompletion) throw new Error("plugin emitted an event after completion");
        switch (part.type) {
          case "text-delta":
            parts.push(part.text);
            yield { type: "text-delta", executionId, text: part.text };
            break;
          case "tool-call":
            calls.push(part.toolCall);
            yield { type: "tool-call", executionId, toolCall: part.toolCall };
            break;
          case "progress":
            yield { type: "progress", executionId, message: part.message };
            break;
          case "completed": {
            sawCompletion = true;
            if (signal.aborted) break;
            log("info", "arcanai", "request completed");
            completed = true;
            yield {
              type: "completed", executionId,
              result: {
                executionId, status: "success", text: parts.join(""),
                finishReason: part.finishReason, usage: part.usage,
                providerMetadata: part.providerMetadata,
                ...(calls.length ? { toolCalls: calls } : {}),
                ...(level !== "off" ? { diagnostics } : {})
              }
            };
            break;
          }
          default:
            throw new Error("plugin emitted unsupported event");
        }
      }
      if (!completed) {
        completed = true;
        const result = signal.aborted
          ? fail("cancelled", "CANCELLED", "request cancelled")
          : fail("error", "STREAM_INCOMPLETE", "plugin stream ended without a completion event");
        yield { type: "failed", executionId, result };
      }
    } catch (error) {
      completed = true;
      const message = error instanceof Error ? error.message : "plugin execution failed";
      const result = signal.aborted
        ? fail("cancelled", "CANCELLED", "request cancelled")
        : fail("error", "PLUGIN_ERROR", message);
      yield { type: "failed", executionId, result };
    } finally {
      if (!completed) controller.abort(new Error("stream consumer closed"));
      request.signal?.removeEventListener("abort", abort);
    }
  }
}

export function createArcanAI(maxDiagnostics: DiagnosticLevel = "trace"): ArcanAI {
  return new ArcanAI(maxDiagnostics);
}
