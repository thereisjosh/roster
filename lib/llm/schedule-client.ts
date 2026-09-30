import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function callScheduleGeneration(opts: {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  temperature: number;
}): Promise<{ content: string; inputTokens: number; outputTokens: number; latencyMs: number }> {
  const start = performance.now();

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: opts.maxTokens,
    temperature: opts.temperature,
    system: opts.systemPrompt,
    messages: [{ role: "user", content: opts.userPrompt }],
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            assignments: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  staffId: { type: "string" },
                  role: { type: "string" },
                  date: { type: "string" },
                  hours: { type: "array", items: { type: "integer" } },
                },
                required: ["staffId", "role", "date", "hours"],
                additionalProperties: false,
              },
            },
            warnings: { type: "array", items: { type: "string" } },
            metadata: {
              type: "object",
              properties: {
                totalStaffHours: { type: "number" },
                totalLaborCost: { type: "number" },
                coveragePercent: { type: "number" },
              },
              required: ["totalStaffHours", "totalLaborCost", "coveragePercent"],
              additionalProperties: false,
            },
          },
          required: ["assignments", "warnings", "metadata"],
          additionalProperties: false,
        },
      },
    },
  });

  const latencyMs = Math.round(performance.now() - start);
  const text = response.content[0].type === "text" ? response.content[0].text : "";

  return {
    content: text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    latencyMs,
  };
}
