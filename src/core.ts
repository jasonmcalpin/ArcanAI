import { parseModelCard, validateOptions, validateProviderOptions } from "./cards.js";
import { ExecutionTimeoutError, supervise, validateTimers } from "./supervision.js";
import { executionLimits, requireCapabilities, enforceTokenLimit } from "./execution-policy.js";
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
    const executionId = crypto.randomUUID();
    const card = parseModelCard(request.card);
    const timers = validateTimers(request.timers);
    const diagnostics: DiagnosticEvent[] = [];
    let diagnosticLimit = 256;
    const requestedLevel = request.diagnostics ?? "off";
    if (!LEVELS.includes(requestedLevel)) throw new TypeError("invalid diagnostic level");
    const level = LEVELS[Math.min(LEVELS.indexOf(requestedLevel), LEVELS.indexOf(this.maxDiagnostics))];
    const log = (severity: DiagnosticEvent["level"], source: string, message: string, data?: JsonRecord): void => {
      if (level === "off" || (level === "basic" && severity === "debug")) return;
      const event: DiagnosticEvent = {
        executionId, timestamp: new Date().toISOString(), level: severity, source, message,
        ...(data ? { data } : {})
      };
      if (diagnostics.length >= diagnosticLimit) return;
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

    const limits = executionLimits(instance, request);
    diagnosticLimit = limits.maxDiagnosticEvents!;
    const capabilityFailure = requireCapabilities(instance, request);
    if (capabilityFailure) {
      yield { type: "failed", executionId,
        result: fail("unavailable", "UNSUPPORTED_CAPABILITY", capabilityFailure) };
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
        if (!["system", "developer", "user", "assistant", "tool"].includes(message.role)) {
          throw new TypeError("invalid message role");
        }
        if (message.toolCalls !== undefined) {
          if (message.role !== "assistant" || !Array.isArray(message.toolCalls) || !message.toolCalls.length ||
            message.toolCalls.some(call => !call || typeof call.id !== "string" || !call.id ||
              typeof call.name !== "string" || !call.name ||
              !call.arguments || typeof call.arguments !== "object" || Array.isArray(call.arguments)))
            throw new TypeError("toolCalls must be nonempty structured assistant tool calls");
          for (const call of message.toolCalls) validateProviderOptions(call.arguments, "message.toolCalls.arguments");
        }
        if (message.toolName !== undefined && (message.role !== "tool" ||
          typeof message.toolName !== "string" || !message.toolName.trim()))
          throw new TypeError("toolName must identify a tool-role message");
        if (typeof message.content === "string") return { ...message };
        if (!Array.isArray(message.content) || message.content.length === 0) {
          throw new TypeError("message content must be text or a nonempty array of parts");
        }
        const parts = message.content.map(part => {
          if (!part || typeof part !== "object") throw new TypeError("invalid content part");
          if (part.type === "text" && typeof part.text === "string") {
            return { type: "text" as const, text: part.text };
          }
          if (part.type === "image" && part.source?.type === "url" && typeof part.source.url === "string" && part.source.url.trim()) {
            return { type: "image" as const, source: { type: "url" as const, url: part.source.url } };
          }
          throw new TypeError("unsupported content part; required image fields are source.type=url and source.url");
        });
        return { ...message, content: parts };
      });
      const options: GenerationOptions = {
        ...validateOptions(instance.defaults?.options),
        ...validateOptions(card.execution.options),
        ...validateOptions(request.options)
      };
      // A host ceiling must also bound cards that omit maxTokens: leaving the
      // field absent would delegate the generation limit to provider defaults.
      if (limits.maxTokens !== undefined && options.maxTokens === undefined)
        options.maxTokens = limits.maxTokens;
      enforceTokenLimit(options, limits);
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
      const reasoning: string[] = [];
      const calls: ToolCall[] = [];
      let textBytes = 0, reasoningBytes = 0;
      let completion: Extract<PluginStreamEvent, { type: "completed" }> | undefined;
      for await (const observed of supervise(run, signal, timers)) {
        if (signal.aborted) break;
        if (observed.kind === "heartbeat") {
          yield { type: "heartbeat", executionId, elapsedMs: observed.elapsedMs, idleMs: observed.idleMs };
          continue;
        }
        const part = observed.value;
        if (completion) throw new Error("plugin emitted an event after completion");
        switch (part.type) {
          case "text-delta":
            textBytes += new TextEncoder().encode(part.text).byteLength;
            if (textBytes > limits.maxOutputBytes!) throw Object.assign(
              new Error("Streamed text exceeds the host capture limit"), { code: "OUTPUT_LIMIT" });
            parts.push(part.text);
            yield { type: "text-delta", executionId, text: part.text };
            break;
          case "reasoning-delta":
            reasoningBytes += new TextEncoder().encode(part.text).byteLength;
            if (reasoningBytes > limits.maxReasoningBytes!) throw Object.assign(
              new Error("Streamed reasoning exceeds the host capture limit"), { code: "REASONING_LIMIT" });
            reasoning.push(part.text);
            yield { type: "reasoning-delta", executionId, text: part.text };
            break;
          case "tool-call":
            if (calls.length >= limits.maxToolCalls!) throw Object.assign(
              new Error("Tool calls exceed the host capture limit"), { code: "TOOL_CALL_LIMIT" });
            calls.push(part.toolCall);
            yield { type: "tool-call", executionId, toolCall: part.toolCall };
            break;
          case "progress":
            yield { type: "progress", executionId, message: part.message };
            break;
          case "completed":
            completion = part;
            break;
          default:
            throw new Error("plugin emitted unsupported event");
        }
      }
      if (signal.aborted || !completion) {
        completed = true;
        const result = signal.aborted
          ? fail("cancelled", "CANCELLED", "request cancelled")
          : fail("error", "STREAM_INCOMPLETE", "plugin stream ended without a completion event");
        yield { type: "failed", executionId, result };
        return;
      }
      log("info", "arcanai", "request completed");
      completed = true;
      yield {
        type: "completed", executionId,
        result: {
          executionId, status: "success", text: parts.join(""),
          ...(reasoning.length ? { reasoning: reasoning.join("") } : {}),
          finishReason: completion.finishReason, usage: completion.usage,
          providerMetadata: completion.providerMetadata,
          ...(calls.length ? { toolCalls: calls } : {}),
          ...(level !== "off" ? { diagnostics } : {})
        }
      };
    } catch (error) {
      completed = true;
      if (error instanceof ExecutionTimeoutError) {
        controller.abort(error);
        yield { type: "failed", executionId, result: fail("timeout", error.reason, error.message) };
      } else {
        const message = error instanceof Error ? error.message : "plugin execution failed";
        const providerCode = error instanceof Error && "code" in error && typeof error.code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code) ? error.code : "PLUGIN_ERROR";
        const result = signal.aborted
          ? fail("cancelled", "CANCELLED", "request cancelled")
          : fail("error", providerCode, message);
        yield { type: "failed", executionId, result };
      }
    } finally {
      if (!completed) controller.abort(new Error("stream consumer closed"));
      request.signal?.removeEventListener("abort", abort);
    }
  }
}

export function createArcanAI(maxDiagnostics: DiagnosticLevel = "trace"): ArcanAI {
  return new ArcanAI(maxDiagnostics);
}
