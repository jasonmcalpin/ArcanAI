/** Public execution contract. No provider-specific logic belongs here. */
export type DiagnosticLevel = "off" | "basic" | "verbose" | "trace";
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonRecord = Record<string, JsonValue>;

/** Structured content is shared by every host; plugin decides how to render it. */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "url"; url: string } };

export interface Message {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content: string | ContentPart[];
  toolCallId?: string;
  /** Structured assistant tool calls from an earlier turn; provider renders natively. */
  toolCalls?: ToolCall[];
  /** Name of the tool producing a tool-role receipt. */
  toolName?: string;
}

export interface GenerationOptions {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
}

export interface ExecutionCard {
  schemaVersion: "1.0";
  id: string;
  execution: {
    plugin: string;
    instance?: string;
    model: string;
    options?: GenerationOptions;
    providerOptions?: JsonRecord;
    /** Declarative plugin-owned model loader settings, never executable code. */
    runtime?: JsonRecord;
    /** Shared declarative prompt, tool, reasoning and generation profile. */
    profile?: JsonRecord;
  };
}

export interface DiagnosticEvent {
  executionId: string;
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  source: string;
  message: string;
  data?: JsonRecord;
}

export interface PluginExecutionRequest {
  model: string;
  messages: Message[];
  options: GenerationOptions;
  providerOptions: JsonRecord;
}

export interface PluginExecutionContext {
  executionId: string;
  signal: AbortSignal;
  log(level: DiagnosticEvent["level"], message: string, data?: JsonRecord): void;
}

export interface PluginExecutionResult {
  text: string;
  finishReason?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  providerMetadata?: JsonRecord;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: JsonRecord;
}

/** A streaming provider must emit exactly one completed event as its final event. */
export type PluginStreamEvent =
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "tool-call"; toolCall: ToolCall }
  | { type: "progress"; message?: string }
  | { type: "completed"; finishReason?: string; usage?: PluginExecutionResult["usage"]; providerMetadata?: JsonRecord };

/** Legacy execute-only plugins are adapted to the same public stream contract. */
export interface ModelPlugin {
  readonly id: string;
  execute?(request: PluginExecutionRequest, context: PluginExecutionContext): Promise<PluginExecutionResult>;
  stream?(request: PluginExecutionRequest, context: PluginExecutionContext): AsyncIterable<PluginStreamEvent>;
  start?(): Promise<void>;
  stop?(): Promise<void>;
}

export interface PluginInstance {
  id: string;
  plugin: ModelPlugin;
  defaults?: {
    options?: GenerationOptions;
    providerOptions?: JsonRecord;
  };
}

export interface GenerateRequest {
  card: ExecutionCard;
  instance?: string;
  messages: Message[];
  options?: GenerationOptions;
  providerOptions?: JsonRecord;
  diagnostics?: DiagnosticLevel;
  signal?: AbortSignal;
  /** Wall-clock liveness controls; omitted deadlines are disabled. */
  timers?: { heartbeatMs?: number; idleMs?: number; totalMs?: number };
  onDiagnostic?: (event: DiagnosticEvent) => void;
}

export type ExecutionStatus = "success" | "error" | "timeout" | "cancelled" | "unavailable";

export interface GenerateResult {
  status: ExecutionStatus;
  executionId: string;
  text?: string;
  reasoning?: string;
  finishReason?: string;
  usage?: PluginExecutionResult["usage"];
  providerMetadata?: JsonRecord;
  toolCalls?: ToolCall[];
  error?: { code: string; message: string };
  diagnostics?: DiagnosticEvent[];
}

/** Public stream events. A terminal event contains the authoritative final result. */
export type ExecutionEvent =
  | { type: "started"; executionId: string; instance: string; model: string }
  | { type: "text-delta"; executionId: string; text: string }
  | { type: "reasoning-delta"; executionId: string; text: string }
  | { type: "tool-call"; executionId: string; toolCall: ToolCall }
  | { type: "progress"; executionId: string; message?: string }
  | { type: "heartbeat"; executionId: string; elapsedMs: number; idleMs: number }
  | { type: "completed"; executionId: string; result: GenerateResult }
  | { type: "failed"; executionId: string; result: GenerateResult };
