import { callWithFallback } from "@/lib/llm";
import { normalise } from "./normalise";

export type RouteTool =
  | "update_availability"
  | "request_cover"
  | "request_swap"
  | "query_schedule"
  | "check_status"
  | "respond_to_offer"
  | "confirm_availability"
  | "unknown";

export interface RouteResult {
  tool: RouteTool;
  params: Record<string, any>;
  missing?: string[];
}

export interface RouteContext {
  today: string;
  hasPendingOffer: boolean;
  hasUnconfirmedSubmission: boolean;
}

const SYSTEM_PROMPT = (ctx: RouteContext) => {
  const dayOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][
    new Date(ctx.today + "T00:00:00Z").getUTCDay()
  ];

  return `You are a message router for a staff rostering system. Today is ${ctx.today} (${dayOfWeek}).

Given a staff member's message, decide which tool to invoke and extract parameters.

Available tools:

1. update_availability — Staff declaring when they can/cannot work for future scheduling.
   Params: {} (slot extraction is handled downstream)
   Examples: "I can work Mon-Fri 9-5", "Saturday off", "available all week", "I'm free next week except Wednesday"

2. request_cover — Staff has an assigned shift they cannot make and needs someone to cover.
   Params: {"date": "YYYY-MM-DD"} — the date of the shift they need covered.
   Examples: "I can't make it tomorrow", "need cover for Wednesday", "MC today I can't come in", "I'm scheduled Saturday but can't come", "I can't come in this week"
   When the message refers to a relative day (e.g. "tomorrow", "Wednesday"), resolve it to a YYYY-MM-DD date relative to today.

3. query_schedule — Asking about their shifts or roster.
   Params: {}
   Examples: "When do I work?", "what are my shifts?", "show my schedule"

4. check_status — Asking about their availability submission status.
   Params: {}
   Examples: "Did my availability go through?", "what did I submit?", "check my status"

5. respond_to_offer — Saying yes or no to a pending cover offer.
   Params: {"accepted": true/false}
   hasPendingOffer is currently ${ctx.hasPendingOffer}.${!ctx.hasPendingOffer ? "\n   ⛔ hasPendingOffer is FALSE — DO NOT route to respond_to_offer under any circumstances." : "\n   ✅ hasPendingOffer is TRUE — use this for short affirmatives/negatives like \"yes\", \"no\", \"I can do it\", \"sorry can't\"."}

6. confirm_availability — Confirming a recently submitted availability.
   Params: {}
   hasUnconfirmedSubmission is currently ${ctx.hasUnconfirmedSubmission}.${!ctx.hasUnconfirmedSubmission ? "\n   ⛔ hasUnconfirmedSubmission is FALSE — DO NOT route to confirm_availability under any circumstances." : "\n   ✅ hasUnconfirmedSubmission is TRUE — use this for confirmations like \"yes\", \"confirm\", \"looks good\"."}

7. unknown — Anything that doesn't fit the above.

8. request_swap — Staff wants to swap their shift with a colleague.
   Params: {"date": "YYYY-MM-DD"} — the date of the shift they want to swap.
   Examples: "Can I swap my Tuesday?", "swap shifts with someone on Friday", "want to trade my Saturday shift"
   When the message refers to a relative day, resolve it to a YYYY-MM-DD date relative to today.
   Params: {}

Users often write in Singlish, Malay, or shorthand. Treat these as equivalent:
- "lah", "la", "lor", "leh", "ah", "alr" are discourse particles — ignore them for intent classification.
- "boleh" = "can" (Malay), "cannot lah" = "no/can't", "can la" = "yes/ok".
- "correct", "yep", "ya", "yup" are affirmatives — treat the same as "yes".
- "tmr" = tomorrow, "tdy" = today, "nxt" = next, "wrk" = work, "sry" = sorry, "mc" = medical certificate (sick leave), "sched" = schedule.

CRITICAL disambiguation for short affirmatives/negatives ("yes", "ok", "sure", "confirm", "looks good", "no", "nah", "can't", "sorry can't", "I can do it", "can", "can la", "cannot lah", "boleh", "correct", "ya", "yep", "yup"):
Right now: hasPendingOffer=${ctx.hasPendingOffer}, hasUnconfirmedSubmission=${ctx.hasUnconfirmedSubmission}.
${ctx.hasPendingOffer ? "→ Route these to respond_to_offer." : ctx.hasUnconfirmedSubmission ? "→ Route these to confirm_availability." : "→ Route these to unknown."}
- "can't work Saturday" with NO urgency language → update_availability (general preference)
- "I can't come in", "can't make it", "won't be in", "MC today" → request_cover (these imply missing existing shifts)
- "I'm scheduled Saturday but can't come" or "need cover for my shift" → request_cover (specific shift)
- When in doubt between update_availability and request_cover: if the message uses phrases like "can't come in", "won't be in", "not coming", or expresses inability to attend (rather than stating preferences), prefer request_cover.

If you cannot determine a required parameter from the message, include it in a "missing" array rather than guessing. For example, if the user says "I can't come in" but doesn't specify a date, respond with {"tool": "request_cover", "params": {}, "missing": ["date"]}.

Respond with JSON only: {"tool": "<tool_name>", "params": {<params>}, "missing": [<missing_params>]}`;
};

export async function routeMessage(
  message: string,
  context: RouteContext,
  businessId: string,
): Promise<RouteResult> {
  const normalised = normalise(message);
  const response = await callWithFallback({
    taskType: "message_routing",
    businessId,
    prompt: normalised,
    systemPrompt: SYSTEM_PROMPT(context),
    jsonMode: true,
    temperature: 0,
  });

  try {
    const parsed = JSON.parse(response.content);
    return {
      tool: parsed.tool as RouteTool,
      params: parsed.params ?? {},
      missing: parsed.missing,
    };
  } catch {
    return { tool: "unknown", params: {} };
  }
}
