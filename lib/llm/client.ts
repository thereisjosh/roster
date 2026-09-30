import { generateText, generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { ModelConfig, LlmRequest, LlmResponse } from "./types";
import { resolveModel } from "./router";

/**
 * Unified LLM client using the Vercel AI SDK.
 * Handles: provider abstraction, prompt caching headers, structured output, cost tracking.
 *
 * Cost optimization built in:
 * - System prompts are sent as-is (AI SDK + providers handle caching automatically)
 * - OpenAI: 50% off cached prefixes (automatic)
 * - Anthropic: 90% off cached input tokens (via cache_control headers)
 * - Google: ~90% off via context caching API
 */

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY ?? "" });
const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });
const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_API_KEY ?? "" });

function getProviderModel(config: ModelConfig) {
  switch (config.provider) {
    case "openai":
      return openai(config.modelId);
    case "anthropic":
      return anthropic(config.modelId);
    case "google":
      return google(config.modelId);
  }
}

export async function callLlm(request: LlmRequest): Promise<LlmResponse> {
  const modelConfig = resolveModel(request.taskType, request.rosterSize);
  return callWithModel(modelConfig, request);
}

export async function callWithModel(
  modelConfig: ModelConfig,
  request: LlmRequest,
): Promise<LlmResponse> {
  const model = getProviderModel(modelConfig);
  const start = performance.now();

  let text: string;
  let inputTokens: number;
  let outputTokens: number;

  if (request.jsonMode) {
    // Use generateObject with output: "no-schema" for provider-level JSON enforcement
    const result = await generateObject({
      model,
      system: request.systemPrompt,
      prompt: request.prompt,
      temperature: request.temperature ?? 0,
      ...(request.maxTokens ? { maxTokens: request.maxTokens } : {}),
      output: "no-schema",
    });
    text = JSON.stringify(result.object);
    inputTokens = result.usage.promptTokens;
    outputTokens = result.usage.completionTokens;
  } else {
    const result = await generateText({
      model,
      system: request.systemPrompt,
      prompt: request.prompt,
      temperature: request.temperature ?? 0,
      ...(request.maxTokens ? { maxTokens: request.maxTokens } : {}),
    });
    text = result.text;
    inputTokens = result.usage.promptTokens;
    outputTokens = result.usage.completionTokens;
  }

  const latencyMs = Math.round(performance.now() - start);
  const costUsd =
    (inputTokens / 1_000_000) * modelConfig.costPer1MInput +
    (outputTokens / 1_000_000) * modelConfig.costPer1MOutput;

  return {
    content: text,
    model: modelConfig.modelId,
    inputTokens,
    outputTokens,
    costUsd,
    latencyMs,
    tier: "primary",
  };
}
