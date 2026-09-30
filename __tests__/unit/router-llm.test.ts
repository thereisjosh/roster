import "dotenv/config";
import { describe, it, expect } from "vitest";
import { routeMessage, type RouteContext } from "@/lib/chat/router";

const ctx: RouteContext = {
  today: "2026-05-03",
  hasPendingOffer: false,
  hasUnconfirmedSubmission: false,
};

const ctxWithOffer: RouteContext = { ...ctx, hasPendingOffer: true };
const ctxWithUnconfirmed: RouteContext = {
  ...ctx,
  hasUnconfirmedSubmission: true,
};

// [message, context, expectedTool]
const cases: [string, RouteContext, string][] = [
  // ── request_cover ──
  ["I can't come in this week", ctx, "request_cover"],
  ["I can't come in tomorrow", ctx, "request_cover"],
  ["can't make it on Friday", ctx, "request_cover"],
  ["won't be in today", ctx, "request_cover"],
  ["MC today", ctx, "request_cover"],
  ["I'm sick, can't come in", ctx, "request_cover"],
  ["need cover for Wednesday", ctx, "request_cover"],
  ["I'm scheduled Saturday but can't come", ctx, "request_cover"],
  ["not coming in tomorrow", ctx, "request_cover"],
  ["sorry I can't make it to work today", ctx, "request_cover"],

  // ── update_availability ──
  ["I can work Mon-Fri 9-5", ctx, "update_availability"],
  ["Saturday off", ctx, "update_availability"],
  ["available all week", ctx, "update_availability"],
  ["I'm free next week except Wednesday", ctx, "update_availability"],
  ["can't work weekends", ctx, "update_availability"],
  ["I can only do mornings", ctx, "update_availability"],

  // ── query_schedule ──
  ["When do I work?", ctx, "query_schedule"],
  ["what are my shifts this week?", ctx, "query_schedule"],
  ["show my schedule", ctx, "query_schedule"],

  // ── check_status ──
  ["Did my availability go through?", ctx, "check_status"],
  ["what did I submit?", ctx, "check_status"],

  // ── respond_to_offer (with pending offer) ──
  ["yes", ctxWithOffer, "respond_to_offer"],
  ["no", ctxWithOffer, "respond_to_offer"],
  ["I can do it", ctxWithOffer, "respond_to_offer"],
  ["sorry can't", ctxWithOffer, "respond_to_offer"],

  // ── confirm_availability (with unconfirmed submission) ──
  ["yes", ctxWithUnconfirmed, "confirm_availability"],
  ["confirm", ctxWithUnconfirmed, "confirm_availability"],
  ["looks good", ctxWithUnconfirmed, "confirm_availability"],

  // ── request_cover — Singlish / shorthand / typos ──
  ["cant come in tmr", ctx, "request_cover"],
  ["cannot make it la", ctx, "request_cover"],
  ["mc lah today", ctx, "request_cover"],
  ["not coming in alr", ctx, "request_cover"],
  ["tmr cant come", ctx, "request_cover"],
  ["sick today cant work", ctx, "request_cover"],
  ["i on mc today", ctx, "request_cover"],
  ["take mc alr", ctx, "request_cover"],
  ["cannt come in tdy", ctx, "request_cover"],
  ["i cant make it to wrk tmr", ctx, "request_cover"],
  ["nt coming in 2day", ctx, "request_cover"],
  ["sry cant come today", ctx, "request_cover"],
  ["feeling unwell, not coming", ctx, "request_cover"],
  ["on medical leave today", ctx, "request_cover"],
  ["emergency leave tmr", ctx, "request_cover"],

  // ── update_availability — Singlish / shorthand / typos ──
  ["can wrk mon to fri", ctx, "update_availability"],
  ["avail whole week", ctx, "update_availability"],
  ["sat n sun off", ctx, "update_availability"],
  ["next wk free except tue", ctx, "update_availability"],
  ["only mornings can", ctx, "update_availability"],
  ["weekends cannot work", ctx, "update_availability"],
  ["i free mon wed fri", ctx, "update_availability"],
  ["nxt week off on thurs", ctx, "update_availability"],
  ["can do evening shift only", ctx, "update_availability"],
  ["availble all days", ctx, "update_availability"],

  // ── query_schedule — Singlish / shorthand / typos ──
  ["when i working", ctx, "query_schedule"],
  ["my shift when ah", ctx, "query_schedule"],
  ["wat time i work tmr", ctx, "query_schedule"],
  ["check roster", ctx, "query_schedule"],
  ["whats my sched", ctx, "query_schedule"],

  // ── check_status — Singlish / shorthand / typos ──
  ["my avail go thru anot", ctx, "check_status"],
  ["did i submit alr", ctx, "check_status"],
  ["status of my submission", ctx, "check_status"],

  // ── respond_to_offer — Singlish (with pending offer) ──
  ["can", ctxWithOffer, "respond_to_offer"],
  ["can la", ctxWithOffer, "respond_to_offer"],
  ["ok can", ctxWithOffer, "respond_to_offer"],
  ["cannot lah", ctxWithOffer, "respond_to_offer"],
  ["boleh", ctxWithOffer, "respond_to_offer"],
  ["sure thing", ctxWithOffer, "respond_to_offer"],
  ["ok i take", ctxWithOffer, "respond_to_offer"],
  ["nah", ctxWithOffer, "respond_to_offer"],

  // ── confirm_availability — Singlish (with unconfirmed submission) ──
  ["yep", ctxWithUnconfirmed, "confirm_availability"],
  ["ya", ctxWithUnconfirmed, "confirm_availability"],
  ["ok can", ctxWithUnconfirmed, "confirm_availability"],
  ["correct", ctxWithUnconfirmed, "confirm_availability"],
  ["yup thats right", ctxWithUnconfirmed, "confirm_availability"],

  // ── unknown — gibberish / off-topic (no flags set) ──
  ["hello", ctx, "unknown"],
  ["haha", ctx, "unknown"],
  ["what is this", ctx, "unknown"],
  ["how are you", ctx, "unknown"],

  // ── Disambiguation edge cases — short messages with NO flags ──
  ["ok", ctx, "unknown"],
  ["can", ctx, "unknown"],
  ["sure", ctx, "unknown"],
  ["ya", ctx, "unknown"],
];

const hasApiKey = !!process.env.OPENAI_API_KEY;

describe.skipIf(!hasApiKey)("Router LLM regression", () => {
  it.each(cases)(
    '"%s" → %s',
    async (message, context, expectedTool) => {
      const result = await routeMessage(message, context, "test-business");
      expect(result.tool).toBe(expectedTool);
    },
    30_000,
  );
});
