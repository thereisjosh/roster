/**
 * Custom promptfoo provider that uses the Anthropic SDK directly
 * with structured outputs (output_config / json_schema) to guarantee
 * valid JSON — no more reasoning preamble or trailing text.
 */

import Anthropic from "@anthropic-ai/sdk";

interface StructuredOutputProviderConfig {
  model?: string;
  temperature?: number;
  max_tokens?: number;
}

const SCHEDULE_SCHEMA = {
  type: "object" as const,
  properties: {
    assignments: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          staffId: { type: "string" as const },
          role: { type: "string" as const },
          date: { type: "string" as const },
          hours: { type: "array" as const, items: { type: "integer" as const } },
        },
        required: ["staffId", "role", "date", "hours"] as const,
        additionalProperties: false,
      },
    },
    warnings: { type: "array" as const, items: { type: "string" as const } },
    metadata: {
      type: "object" as const,
      properties: {
        totalStaffHours: { type: "number" as const },
        totalLaborCost: { type: "number" as const },
        coveragePercent: { type: "number" as const },
      },
      required: ["totalStaffHours", "totalLaborCost", "coveragePercent"] as const,
      additionalProperties: false,
    },
  },
  required: ["assignments", "warnings", "metadata"] as const,
  additionalProperties: false,
};

class StructuredOutputProvider {
  private config: StructuredOutputProviderConfig;
  private client: Anthropic;
  private providerId: string;

  constructor(options: { id?: string; config?: StructuredOutputProviderConfig }) {
    this.config = options.config ?? {};
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    this.providerId = options.id ?? `structured-output:${this.config.model ?? "claude-sonnet-4-6"}`;
  }

  id() {
    return this.providerId;
  }

  async callApi(prompt: string) {
    const model = this.config.model ?? "claude-sonnet-4-6";
    const temperature = this.config.temperature ?? 0;
    const maxTokens = this.config.max_tokens ?? 16384;

    const start = performance.now();

    const response = await this.client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      messages: [{ role: "user", content: prompt }],
      output_config: {
        format: {
          type: "json_schema",
          schema: SCHEDULE_SCHEMA,
        },
      },
    });

    const latencyMs = Math.round(performance.now() - start);
    const text = response.content[0].type === "text" ? response.content[0].text : "";

    return {
      output: text,
      tokenUsage: {
        total: response.usage.input_tokens + response.usage.output_tokens,
        prompt: response.usage.input_tokens,
        completion: response.usage.output_tokens,
      },
    };
  }
}

export default StructuredOutputProvider;
