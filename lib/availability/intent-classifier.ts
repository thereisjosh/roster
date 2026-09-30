import { callWithFallback } from "@/lib/llm";

export type Intent =
  | "availability_update"
  | "schedule_query"
  | "swap_request"
  | "cover_request"
  | "status_query"
  | "confirmation"
  | "rejection"
  | "unknown";

export async function classifyIntent(
  message: string,
  businessId: string,
): Promise<{ intent: Intent; confidence: number }> {
  const response = await callWithFallback({
    taskType: "classification",
    businessId,
    prompt: message,
    systemPrompt: `You are an intent classifier for a staff rostering system. Classify the user's message into one of these intents:
- availability_update: staff submitting when they can/cannot work (e.g. "I can work Monday 9-5", "Saturday off", "available all week")
- schedule_query: asking about their schedule or shifts (e.g. "when do I work?", "what are my shifts?")
- swap_request: requesting to swap/trade shifts (e.g. "can I swap my Tuesday shift?")
- cover_request: requesting cover or reporting absence (e.g. "I can't make it tomorrow", "need someone to cover my Wednesday shift", "MC today I can't come in")
- status_query: asking about their submission status (e.g. "did my availability go through?", "what did I submit?", "check my status")
- confirmation: confirming something (e.g. "yes", "ok", "confirm")
- rejection: declining something (e.g. "no", "decline")
- unknown: anything else

Respond with JSON only: {"intent": "<intent>", "confidence": <0.0-1.0>}`,
    jsonMode: true,
    temperature: 0,
  });

  try {
    const parsed = JSON.parse(response.content);
    return {
      intent: parsed.intent as Intent,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.6,
    };
  } catch {
    return { intent: "unknown", confidence: 0 };
  }
}
