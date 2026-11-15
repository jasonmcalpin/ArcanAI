/** Portable declarative prompt, tool and reasoning profile contract.
 * This is owned by the Transformers.js provider, not by a benchmark host.
 */
export type Workload = "production" | "direct" | "tool";
export type AutoSetting<T> = T | "auto";
export interface GenerationProfile {
  doSample?: AutoSetting<boolean>;
  temperature?: AutoSetting<number>;
  topP?: AutoSetting<number>;
  topK?: AutoSetting<number>;
  presencePenalty?: AutoSetting<number>;
  repetitionPenalty?: AutoSetting<number>;
  minP?: AutoSetting<number>;
}
export interface GenerationSettings {
  maxNewTokens: number;
  doSample?: boolean;
  temperature?: number;
  topP?: number;
  topK?: number;
  presencePenalty?: number;
  repetitionPenalty?: number;
  minP?: number;
}
export interface ProfileMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
}
export interface ModelToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Readonly<Record<string, { type: string; description: string }>>;
    required: readonly string[];
    additionalProperties: false;
  };
}
export interface ModelProfile {
  id: string;
  family: string;
  runtime: {
    kind: "pipeline" | "direct-model";
    pipelineTask?: "text-generation" | "auto";
    modelClass?: "Qwen3_5ForConditionalGeneration" | "AutoModelForCausalLM" | "auto";
    processorClass?: "AutoProcessor" | "auto";
    dtype: string | Readonly<Record<string, string>>;
    minimumTransformersJs?: string;
  };
  chat: {
    renderer: "tokenizer-template" | "message-format";
    promptPlacement: "preserve-roles" | "user-only";
    historyReasoning: "preserve" | "strip" | "template-managed" | "unknown";
    userOnlyFormatting?: {
      systemTemplate: string;
      messageTemplate: string;
      toolTemplate: string;
      separator: string;
    };
    messageFormat?: {
      systemPrefix: string;
      userPrefix: string;
      assistantPrefix: string;
      toolPrefix: string;
      separator: string;
      generationSuffix: string;
      defaultSystemMessage?: string;
    };
  };
  tools: {
    mode: "native-template" | "prompted-protocol" | "unknown" | "unsupported";
    callFormat: "canonical-json" | "tagged-json" | "lfm3-xml";
    callParser: "json-or-tagged-json" | "lfm3-xml";
    tokenizerTools: boolean;
    definitionFormat: "openai-functions";
    promptedProtocol?: { systemTemplate: string; toolResultTemplate: string };
  };
  reasoning: {
    supported: boolean | "unknown";
    defaultMode: "thinking" | "non-thinking" | "unknown";
    control?: "enable_thinking" | "forced-think-prefix" | "template-managed" | "auto";
    enabledForBenchmark?: boolean;
    promptSuffix?: string;
  };
  profiles: Readonly<Record<Workload, GenerationProfile>>;
  visionProfile?: GenerationProfile;
  adapterId: string;
  sources?: readonly string[];
}
export interface ProfileCandidate {
  id: string;
  family: string;
  adapterId: string;
  compatibilityProfileId: string;
  compatibilityProfile: ModelProfile;
}
export interface ProfileRequest {
  messages: readonly ProfileMessage[];
  maxNewTokens: number;
  workload: Workload;
  generationOverrides?: GenerationProfile;
  reasoningOverride?: boolean;
  tools?: readonly ModelToolDefinition[];
}
export interface PreparedModelInvocation {
  messages: readonly ProfileMessage[];
  tokenizerEncodeOptions?: Readonly<Record<string, unknown>>;
  settings: GenerationSettings;
  adapterId: string;
  toolCallFormat: ModelProfile["tools"]["callFormat"];
  compatibilityProfileId: string;
}
export interface PreparedVisionInvocation {
  imageUrl: string;
  prompt: string;
  settings: GenerationSettings;
  compatibilityProfileId: string;
}
export type ParsedTurn = { type: "tool_call"; call: { tool: string; args: Record<string, unknown> } }
  | { type: "final"; answer: unknown };
