import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  business,
  availabilitySubmission,
  coverOffer,
  coverRequest,
} from "@/lib/db/schema";
import { parseAvailability } from "@/lib/availability/nl-parser";
import { upsertAvailability } from "@/lib/availability/submit-from-chat";
import {
  HELP_TEXT,
  handleScheduleQuery,
  handleStatusQuery,
  handleCoverRequest,
  handleSwapRequest,
} from "@/lib/chat/handlers";
import { inngest } from "@/lib/inngest/client";
import type { RouteTool } from "@/lib/chat/router";
import {
  setState,
  clearState,
  type PendingState,
} from "@/lib/chat/conversation-state";

export interface InlineButton {
  text: string;
  callback_data: string;
}

export interface ExecuteResult {
  reply: string;
  replyMarkup?: { inline_keyboard: InlineButton[][] };
}

/**
 * Build day-picker buttons for the next 7 days.
 */
function buildDayPicker(): InlineButton[][] {
  const today = new Date();
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const rows: InlineButton[][] = [];
  let row: InlineButton[] = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const dateStr = `${yyyy}-${mm}-${dd}`;
    const label = `${dayNames[d.getDay()]} ${d.getDate()} ${monthNames[d.getMonth()]}`;

    row.push({ text: label, callback_data: `cover_date_${dateStr}` });
    if (row.length === 3 || i === 6) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length > 0) rows.push(row);
  return rows;
}

export async function executeAction(
  tool: RouteTool,
  params: Record<string, any>,
  missing: string[] | undefined,
  staffId: string,
  businessId: string,
  messageText: string,
  context: {
    pendingOffer?: { coverRequestId: string; candidateStaffId: string } | null;
    latestSubmission?: { id: string; status: string } | null;
  },
): Promise<ExecuteResult> {
  switch (tool) {
    case "update_availability": {
      const biz = await db.query.business.findFirst({
        where: eq(business.id, businessId),
      });
      const weekStartDay = biz?.config?.weekStartDay ?? 1;

      const { slots, weekStart } = await parseAvailability(
        messageText,
        businessId,
        weekStartDay,
      );

      if (slots.length === 0) {
        return {
          reply:
            "I couldn't understand your availability. Try something like:\n• \"Monday to Friday 9am-5pm\"\n• \"Saturday off\"\n• \"Available all week\"",
        };
      }

      const submission = await upsertAvailability(staffId, weekStart, slots);

      const summary = slots
        .map((s) => {
          const d = new Date(s.day);
          const dayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
            d.getUTCDay()
          ];
          if (s.preference === "unavailable") return `${dayName}: OFF`;
          return `${dayName}: ${s.startTime}-${s.endTime} ✓`;
        })
        .join("\n");

      return {
        reply: `Got it! Here's what I recorded:\n${summary}\n\nLook correct?`,
        replyMarkup: {
          inline_keyboard: [
            [
              { text: "Confirm ✓", callback_data: `avail_confirm_${submission.id}` },
              { text: "Redo ✗", callback_data: "avail_redo" },
            ],
          ],
        },
      };
    }

    case "request_cover": {
      // Missing date → save state + send day picker
      if (missing?.includes("date") || !params.date) {
        await setState(staffId, "request_cover", params, "date", "telegram");
        return {
          reply: "Which day do you need cover for?",
          replyMarkup: { inline_keyboard: buildDayPicker() },
        };
      }

      const result = await handleCoverRequest(staffId, businessId, params.date);

      if (result.coverRequestId) {
        return {
          reply: result.reply,
          replyMarkup: {
            inline_keyboard: [
              [
                {
                  text: "Cancel Request",
                  callback_data: `cover_cancel_${result.coverRequestId}`,
                },
              ],
            ],
          },
        };
      }

      return { reply: result.reply };
    }

    case "respond_to_offer": {
      if (context.pendingOffer) {
        const accepted = params.accepted === true;
        await inngest.send({
          name: "cover/offer.responded",
          data: {
            coverRequestId: context.pendingOffer.coverRequestId,
            candidateStaffId: staffId,
            accepted,
          },
        });
        return {
          reply: accepted
            ? "Thanks! I've noted you're available."
            : "No worries, I'll ask someone else.",
        };
      }
      return { reply: "Nothing to respond to right now." };
    }

    case "confirm_availability": {
      if (
        context.latestSubmission &&
        context.latestSubmission.status === "submitted"
      ) {
        await db
          .update(availabilitySubmission)
          .set({ status: "confirmed" })
          .where(eq(availabilitySubmission.id, context.latestSubmission.id));
        return { reply: "Availability confirmed!" };
      }
      return { reply: "Nothing to confirm right now." };
    }

    case "query_schedule": {
      const reply = await handleScheduleQuery(staffId, businessId);
      return { reply };
    }

    case "check_status": {
      const reply = await handleStatusQuery(staffId);
      return { reply };
    }

    case "request_swap": {
      // Missing date → save state + send day picker
      if (missing?.includes("date") || !params.date) {
        await setState(staffId, "request_swap", params, "date", "telegram");
        return {
          reply: "Which day do you want to swap?",
          replyMarkup: { inline_keyboard: buildDayPicker() },
        };
      }

      const swapResult = await handleSwapRequest(staffId, businessId, params.date);
      if (swapResult.coverRequestId) {
        return {
          reply: swapResult.reply,
          replyMarkup: {
            inline_keyboard: [
              [
                {
                  text: "Cancel Swap",
                  callback_data: `cover_cancel_${swapResult.coverRequestId}`,
                },
              ],
            ],
          },
        };
      }
      return { reply: swapResult.reply };
    }

    default: {
      return {
        reply:
          "I didn't understand that. Try one of these or type /help:",
        replyMarkup: {
          inline_keyboard: [
            [
              { text: "📅 My Schedule", callback_data: "action_schedule" },
              { text: "📋 My Status", callback_data: "action_status" },
              { text: "❓ Help", callback_data: "action_help" },
            ],
          ],
        },
      };
    }
  }
}

/**
 * Resolve a pending conversation state by parsing the user's reply
 * to fill the missing parameter, then re-execute the action.
 *
 * Returns null if the reply couldn't be parsed (caller should clear state
 * and fall through to normal routing).
 */
export async function resolveConversationState(
  state: PendingState,
  messageText: string,
  staffId: string,
  businessId: string,
  context: {
    pendingOffer?: { coverRequestId: string; candidateStaffId: string } | null;
    latestSubmission?: { id: string; status: string } | null;
  },
): Promise<ExecuteResult | null> {
  if (state.pendingPrompt === "date") {
    const date = parseDateReply(messageText);
    if (!date) return null;

    const mergedParams = { ...state.pendingParams, date };
    return executeAction(
      state.pendingTool as RouteTool,
      mergedParams,
      undefined,
      staffId,
      businessId,
      messageText,
      context,
    );
  }

  return null;
}

/**
 * Parse a date from a user reply. Handles:
 * - callback data format: "cover_date_YYYY-MM-DD"
 * - ISO date: "2025-05-07"
 * - Relative day names: "Friday", "monday", "tmr", "tomorrow"
 */
function parseDateReply(text: string): string | null {
  const trimmed = text.trim();

  // Callback data format
  if (trimmed.startsWith("cover_date_")) {
    return trimmed.replace("cover_date_", "");
  }

  // ISO date
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  // Relative day names
  const dayMap: Record<string, number> = {
    sunday: 0, sun: 0,
    monday: 1, mon: 1,
    tuesday: 2, tue: 2, tues: 2,
    wednesday: 3, wed: 3,
    thursday: 4, thu: 4, thurs: 4,
    friday: 5, fri: 5,
    saturday: 6, sat: 6,
    today: -1, tdy: -1,
    tomorrow: -2, tmr: -2, tmrw: -2,
  };

  const lower = trimmed.toLowerCase();
  const targetDay = dayMap[lower];

  if (targetDay === undefined) return null;

  const now = new Date();
  if (targetDay === -1) {
    // today
    return toISO(now);
  }
  if (targetDay === -2) {
    // tomorrow
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return toISO(d);
  }

  // Next occurrence of the given weekday
  const currentDay = now.getDay();
  let daysAhead = targetDay - currentDay;
  if (daysAhead <= 0) daysAhead += 7;
  const d = new Date(now);
  d.setDate(d.getDate() + daysAhead);
  return toISO(d);
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
