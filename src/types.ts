/** Public execution contract. No provider-specific logic belongs here. */
export type DiagnosticLevel = "off" | "basic" | "verbose" | "trace";
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonRecord = Record<string, JsonValue>;

export interface Message {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
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

export interface ModelPlugin {
  readonly id: string;
  execute(request: PluginExecutionRequest, context: PluginExecutionContext): Promise<PluginExecutionResult>;
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
  onDiagnostic?: (event: DiagnosticEvent) => void;
}

export type ExecutionStatus = "success" | "error" | "timeout" | "cancelled" | "unavailable";

export interface GenerateResult {
  status: ExecutionStatus;
  executionId: string;
  text?: string;
  finishReason?: string;
  usage?: PluginExecutionResult["usage"];
  providerMetadata?: JsonRecord;
  error?: { code: string; message: string };
  diagnostics?: DiagnosticEvent[];
}
