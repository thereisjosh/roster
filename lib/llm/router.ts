import type { ModelConfig, TaskRouteConfig, TaskType } from "./types";

/**
 * Model definitions — single source of truth for all model configs and costs.
 */
const MODELS = {
  gemini25Pro: {
    provider: "google",
    modelId: "gemini-2.5-pro",
    costPer1MInput: 1.25,
    costPer1MOutput: 10.0,
    supportsJsonMode: true,
    supportsBatch: true,
    maxContextTokens: 1_000_000,
  },
  gemini25Flash: {
    provider: "google",
    modelId: "gemini-2.5-flash",
    costPer1MInput: 0.15,
    costPer1MOutput: 0.60,
    supportsJsonMode: true,
    supportsBatch: true,
    maxContextTokens: 1_000_000,
  },
  gemini25ProBatch: {
    provider: "google",
    modelId: "gemini-2.5-pro",
    costPer1MInput: 0.625, // 50% batch discount
    costPer1MOutput: 5.0,
    supportsJsonMode: true,
    supportsBatch: true,
    maxContextTokens: 1_000_000,
  },
  gpt41Mini: {
    provider: "openai",
    modelId: "gpt-4.1-mini",
    costPer1MInput: 0.4,
    costPer1MOutput: 1.6,
    supportsJsonMode: true,
    supportsBatch: true,
    maxContextTokens: 1_000_000,
  },
  gpt41Nano: {
    provider: "openai",
    modelId: "gpt-4.1-nano",
    costPer1MInput: 0.1,
    costPer1MOutput: 0.4,
    supportsJsonMode: true,
    supportsBatch: true,
    maxContextTokens: 1_000_000,
  },
  claudeHaiku45: {
    provider: "anthropic",
    modelId: "claude-haiku-4-5-20251001",
    costPer1MInput: 1.0,
    costPer1MOutput: 5.0,
    supportsJsonMode: true,
    supportsBatch: true,
    maxContextTokens: 200_000,
  },
  claudeSonnet45: {
    provider: "anthropic",
    modelId: "claude-sonnet-4-5-20250929",
    costPer1MInput: 3.0,
    costPer1MOutput: 15.0,
    supportsJsonMode: true,
    supportsBatch: true,
    maxContextTokens: 200_000,
  },
  claudeSonnet46: {
    provider: "anthropic",
    modelId: "claude-sonnet-4-6",
    costPer1MInput: 3.0,
    costPer1MOutput: 15.0,
    supportsJsonMode: true,
    supportsBatch: true,
    maxContextTokens: 200_000,
  },
} as const satisfies Record<string, ModelConfig>;

/**
 * Task → model routing table.
 *
 * Each task defines:
 * - primary: cheapest model that meets quality bar (validated by evals)
 * - fallbackLlm: next model to try if primary fails
 * - hasDeterministicFallback: whether a non-LLM fallback exists
 * - complexityThreshold: roster size below which simpleModel is used
 */
export const ROUTE_TABLE: Partial<Record<TaskType, TaskRouteConfig>> = {
  nl_availability_parsing: {
    taskType: "nl_availability_parsing",
    primary: MODELS.gpt41Mini,
    fallbackLlm: MODELS.claudeHaiku45,
    hasDeterministicFallback: true, // regex + keyword parser
  },
  preference_extraction: {
    taskType: "preference_extraction",
    primary: MODELS.claudeHaiku45,
    fallbackLlm: MODELS.claudeSonnet45,
    hasDeterministicFallback: false,
  },
  classification: {
    taskType: "classification",
    primary: MODELS.gpt41Nano,
    fallbackLlm: null,
    hasDeterministicFallback: true, // rule-based classifier
  },
  message_routing: {
    taskType: "message_routing",
    primary: MODELS.gpt41Nano,
    fallbackLlm: MODELS.claudeHaiku45,
    hasDeterministicFallback: true, // keyword-based fallback
  },
  pattern_mining: {
    taskType: "pattern_mining",
    primary: MODELS.gemini25ProBatch,
    fallbackLlm: MODELS.claudeSonnet45,
    hasDeterministicFallback: false,
  },
  json_validation: {
    taskType: "json_validation",
    primary: MODELS.gpt41Nano,
    fallbackLlm: null,
    hasDeterministicFallback: true, // JSON Schema validation
  },
};

/**
 * Resolve which model config to use for a given task and context.
 */
export function resolveModel(taskType: TaskType, rosterSize?: number): ModelConfig {
  const route = ROUTE_TABLE[taskType];
  if (!route) throw new Error(`No route configured for task type: ${taskType}`);

  // Use cheaper model for simple rosters
  if (route.complexityThreshold && route.simpleModel && rosterSize !== undefined) {
    if (rosterSize <= route.complexityThreshold) {
      return route.simpleModel;
    }
  }

  return route.primary;
}

export { MODELS };
