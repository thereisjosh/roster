import type { LlmRequest, LlmResponse, TaskType } from "./types";
import { ROUTE_TABLE } from "./router";
import { callLlm, callWithModel } from "./client";
import { modelHealth } from "./health";
import { normalise } from "@/lib/chat/normalise";
import { createLogger } from "@/lib/logging";

const logger = createLogger("llm-fallback");

/**
 * Deterministic (non-LLM) fallback implementations.
 * These ensure the product never breaks if all LLMs are down.
 */
const DETERMINISTIC_FALLBACKS: Partial<Record<TaskType, (prompt: string) => string>> = {
  /**
   * Regex + keyword parser for availability messages.
   * Handles common patterns: "Monday off", "available 9-5", "cannot work Sat".
   */
  nl_availability_parsing: (prompt: string) => {
    const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
    const text = prompt.toLowerCase();
    const entries: Array<{ day: string; available: boolean; timeRange?: string }> = [];

    for (const day of days) {
      const dayShort = day.slice(0, 3);
      if (text.includes(day) || text.includes(dayShort)) {
        const unavailablePatterns = ["off", "cannot", "can't", "cant", "no", "unavailable", "mc", "leave"];
        const isUnavailable = unavailablePatterns.some(
          (p) => text.includes(`${day} ${p}`) || text.includes(`${dayShort} ${p}`),
        );
        entries.push({ day, available: !isUnavailable });
      }
    }

    return JSON.stringify({ entries, method: "regex_keyword_parser" });
  },

  /**
   * Rule-based intent classifier using keyword matching.
   */
  classification: (prompt: string) => {
    const text = prompt.toLowerCase();
    const intents: Record<string, string[]> = {
      availability_update: ["available", "unavailable", "off", "leave", "mc", "cannot work"],
      schedule_query: ["schedule", "shift", "roster", "when am i", "my shifts"],
      swap_request: ["swap", "switch", "trade", "exchange"],
      confirmation: ["yes", "ok", "confirm", "sure", "can"],
      rejection: ["no", "cannot", "can't", "reject", "decline"],
    };

    for (const [intent, keywords] of Object.entries(intents)) {
      if (keywords.some((kw) => text.includes(kw))) {
        return JSON.stringify({ intent, confidence: 0.6, method: "rule_based" });
      }
    }

    return JSON.stringify({ intent: "unknown", confidence: 0.0, method: "rule_based" });
  },

  /**
   * Keyword-based message routing fallback.
   * Maps messages to tool names when all LLMs are down.
   */
  message_routing: (prompt: string) => {
    const text = normalise(prompt);
    const tools: Record<string, string[]> = {
      update_availability: ["available", "unavailable", "off", "leave", "mc", "cannot work", "can work"],
      request_cover: ["cover", "can't make it", "cant make it", "absent", "sick"],
      request_swap: ["swap", "switch", "trade", "exchange shift"],
      query_schedule: ["schedule", "shift", "roster", "when do i", "my shifts", "when am i"],
      check_status: ["status", "did my", "go through", "submitted", "check my"],
    };

    for (const [tool, keywords] of Object.entries(tools)) {
      if (keywords.some((kw) => text.includes(kw))) {
        return JSON.stringify({ tool, params: {}, method: "keyword_fallback" });
      }
    }

    return JSON.stringify({ tool: "unknown", params: {}, method: "keyword_fallback" });
  },

  /**
   * JSON Schema validation — no LLM needed.
   */
  json_validation: (prompt: string) => {
    try {
      JSON.parse(prompt);
      return JSON.stringify({ valid: true, method: "json_parse" });
    } catch (e) {
      return JSON.stringify({
        valid: false,
        error: e instanceof Error ? e.message : "Invalid JSON",
        method: "json_parse",
      });
    }
  },
};

export interface FallbackCallbacks {
  onEscalation?: (taskType: TaskType, error: string) => Promise<void>;
}

/**
 * Three-tier fallback chain per task:
 * 1. Primary model (cheapest that meets quality bar)
 * 2. Fallback LLM (more expensive, higher reliability)
 * 3. Deterministic fallback (no LLM, always works)
 *
 * If all tiers fail, triggers an escalation alert.
 */
export async function callWithFallback(
  request: LlmRequest,
  callbacks?: FallbackCallbacks,
): Promise<LlmResponse> {
  const route = ROUTE_TABLE[request.taskType];
  if (!route) throw new Error(`No route configured for task type: ${request.taskType}`);

  const primaryHealthy = modelHealth.isHealthy(route.primary.modelId, request.taskType);
  const tryFallbackFirst = !primaryHealthy && !!route.fallbackLlm;

  // If primary is unhealthy and fallback exists, try fallback first
  if (tryFallbackFirst) {
    logger.warn({ taskType: request.taskType, model: route.primary.modelId }, "primary unhealthy, trying fallback first");
    try {
      const start = Date.now();
      const response = await callWithModel(route.fallbackLlm!, request);
      modelHealth.record(route.fallbackLlm!.modelId, request.taskType, true, Date.now() - start);
      return { ...response, tier: "fallback_llm" };
    } catch {
      // Fallback also failed, continue to try primary anyway
    }
  }

  // Tier 1: Primary model
  try {
    const start = Date.now();
    const response = await callLlm(request);
    modelHealth.record(route.primary.modelId, request.taskType, true, Date.now() - start);
    return response;
  } catch (primaryError) {
    const primaryMsg = primaryError instanceof Error ? primaryError.message : "Primary model failed";
    modelHealth.record(route.primary.modelId, request.taskType, false, 0);

    // Tier 2: Fallback LLM (skip if already tried above)
    if (route.fallbackLlm && !tryFallbackFirst) {
      try {
        const start = Date.now();
        const response = await callWithModel(route.fallbackLlm, request);
        modelHealth.record(route.fallbackLlm.modelId, request.taskType, true, Date.now() - start);
        return { ...response, tier: "fallback_llm" };
      } catch {
        // Continue to tier 3
      }
    }

    // Tier 3: Deterministic fallback
    if (route.hasDeterministicFallback) {
      const fallbackFn = DETERMINISTIC_FALLBACKS[request.taskType];
      if (fallbackFn) {
        const content = fallbackFn(request.prompt);
        return {
          content,
          model: "deterministic",
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          latencyMs: 0,
          tier: "deterministic",
        };
      }
    }

    // All tiers failed — escalate
    logger.warn({ taskType: request.taskType, error: primaryMsg }, "all LLM tiers exhausted");
    if (callbacks?.onEscalation) {
      await callbacks.onEscalation(request.taskType, primaryMsg);
    }

    throw new Error(`All fallback tiers exhausted for ${request.taskType}: ${primaryMsg}`);
  }
}
