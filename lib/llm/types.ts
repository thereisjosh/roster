export type TaskType =
  | "schedule_generation"
  | "nl_availability_parsing"
  | "preference_extraction"
  | "classification"
  | "message_routing"
  | "pattern_mining"
  | "json_validation"
  | "knowledge_lint";

export type ModelProvider = "google" | "openai" | "anthropic";

export interface ModelConfig {
  provider: ModelProvider;
  modelId: string;
  costPer1MInput: number;
  costPer1MOutput: number;
  supportsJsonMode: boolean;
  supportsBatch: boolean;
  maxContextTokens: number;
}

export interface TaskRouteConfig {
  taskType: TaskType;
  primary: ModelConfig;
  fallbackLlm: ModelConfig | null;
  /** If true, a deterministic (non-LLM) fallback exists for this task */
  hasDeterministicFallback: boolean;
  /** Roster size threshold — below this, use a cheaper model */
  complexityThreshold?: number;
  /** Cheaper model for simple cases */
  simpleModel?: ModelConfig;
}

export interface LlmCallLog {
  id?: string;
  businessId: string;
  taskType: TaskType;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  success: boolean;
  error?: string;
  createdAt: Date;
}

export interface LlmRequest {
  taskType: TaskType;
  businessId: string;
  prompt: string;
  systemPrompt?: string;
  /** Number of staff in the roster — used for complexity routing */
  rosterSize?: number;
  /** Force JSON output */
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export interface LlmResponse {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  tier: "primary" | "fallback_llm" | "deterministic";
}
