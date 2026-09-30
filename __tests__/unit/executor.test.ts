import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before imports
vi.mock("@/lib/db", () => ({
  db: {
    query: {
      business: { findFirst: vi.fn() },
    },
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockResolvedValue(undefined),
      })),
    })),
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockImplementation(() => ({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      })),
    })),
  },
}));

vi.mock("@/lib/availability/nl-parser", () => ({
  parseAvailability: vi.fn(),
}));

vi.mock("@/lib/availability/submit-from-chat", () => ({
  upsertAvailability: vi.fn(),
}));

vi.mock("@/lib/chat/handlers", () => ({
  HELP_TEXT: "Help text",
  handleScheduleQuery: vi.fn(),
  handleStatusQuery: vi.fn(),
  handleCoverRequest: vi.fn(),
}));

vi.mock("@/lib/inngest/client", () => ({
  inngest: { send: vi.fn() },
}));

import { executeAction } from "@/lib/chat/executor";
import { parseAvailability } from "@/lib/availability/nl-parser";
import { upsertAvailability } from "@/lib/availability/submit-from-chat";
import { handleScheduleQuery, handleStatusQuery, handleCoverRequest } from "@/lib/chat/handlers";
import { inngest } from "@/lib/inngest/client";
import { db } from "@/lib/db";

const mockParseAvailability = vi.mocked(parseAvailability);
const mockUpsertAvailability = vi.mocked(upsertAvailability);
const mockHandleScheduleQuery = vi.mocked(handleScheduleQuery);
const mockHandleStatusQuery = vi.mocked(handleStatusQuery);
const mockHandleCoverRequest = vi.mocked(handleCoverRequest);
const mockInngestSend = vi.mocked(inngest.send);

const STAFF_ID = "staff-1";
const BIZ_ID = "biz-1";
const emptyContext = { pendingOffer: null, latestSubmission: null };

describe("executeAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.query.business.findFirst).mockResolvedValue({
      id: BIZ_ID,
      config: { weekStartDay: 1 },
    } as never);
    vi.mocked(db.update).mockImplementation(() => ({
      set: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockResolvedValue(undefined),
      })),
    }) as never);
    vi.mocked(db.insert).mockImplementation(() => ({
      values: vi.fn().mockImplementation(() => ({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      })),
    }) as never);
  });

  describe("request_cover", () => {
    it("returns day picker buttons when date is missing", async () => {
      const result = await executeAction(
        "request_cover",
        {},
        ["date"],
        STAFF_ID,
        BIZ_ID,
        "I can't come in",
        emptyContext,
      );

      expect(result.reply).toBe("Which day do you need cover for?");
      expect(result.replyMarkup).toBeDefined();
      const buttons = result.replyMarkup!.inline_keyboard.flat();
      expect(buttons.length).toBe(7);
      expect(buttons[0].callback_data).toMatch(/^cover_date_\d{4}-\d{2}-\d{2}$/);
    });

    it("returns day picker when date param is absent even without missing array", async () => {
      const result = await executeAction(
        "request_cover",
        {},
        undefined,
        STAFF_ID,
        BIZ_ID,
        "I can't come in",
        emptyContext,
      );

      expect(result.reply).toBe("Which day do you need cover for?");
      expect(result.replyMarkup).toBeDefined();
    });

    it("executes cover request with cancel button when date is present", async () => {
      mockHandleCoverRequest.mockResolvedValue({
        reply: "Got it — I'll find someone to cover your Mon shift.",
        coverRequestId: "cr-1",
      });

      const result = await executeAction(
        "request_cover",
        { date: "2026-05-05" },
        undefined,
        STAFF_ID,
        BIZ_ID,
        "I can't make it Monday",
        emptyContext,
      );

      expect(result.reply).toContain("cover your Mon");
      expect(result.replyMarkup).toBeDefined();
      const cancelBtn = result.replyMarkup!.inline_keyboard[0][0];
      expect(cancelBtn.text).toBe("Cancel Request");
      expect(cancelBtn.callback_data).toBe("cover_cancel_cr-1");
    });

    it("returns plain reply when cover request fails (no coverRequestId)", async () => {
      mockHandleCoverRequest.mockResolvedValue({
        reply: "I couldn't find a shift for you on 2026-05-05.",
      });

      const result = await executeAction(
        "request_cover",
        { date: "2026-05-05" },
        undefined,
        STAFF_ID,
        BIZ_ID,
        "cover for Monday",
        emptyContext,
      );

      expect(result.reply).toContain("couldn't find");
      expect(result.replyMarkup).toBeUndefined();
    });
  });

  describe("update_availability", () => {
    it("returns confirm/redo buttons on successful parse", async () => {
      mockParseAvailability.mockResolvedValue({
        slots: [
          { day: "2026-05-05", startTime: "09:00", endTime: "17:00", preference: "available" as const },
        ],
        weekStart: new Date("2026-05-04"),
      });
      mockUpsertAvailability.mockResolvedValue({ id: "sub-1" } as never);

      const result = await executeAction(
        "update_availability",
        {},
        undefined,
        STAFF_ID,
        BIZ_ID,
        "Mon 9-5",
        emptyContext,
      );

      expect(result.reply).toContain("Tue: 09:00-17:00");
      expect(result.replyMarkup).toBeDefined();
      const buttons = result.replyMarkup!.inline_keyboard[0];
      expect(buttons[0].text).toBe("Confirm ✓");
      expect(buttons[0].callback_data).toBe("avail_confirm_sub-1");
      expect(buttons[1].text).toBe("Redo ✗");
      expect(buttons[1].callback_data).toBe("avail_redo");
    });

    it("returns error text with no buttons when parse fails", async () => {
      mockParseAvailability.mockResolvedValue({
        slots: [],
        weekStart: new Date("2026-05-04"),
      });

      const result = await executeAction(
        "update_availability",
        {},
        undefined,
        STAFF_ID,
        BIZ_ID,
        "asdfgh",
        emptyContext,
      );

      expect(result.reply).toContain("couldn't understand");
      expect(result.replyMarkup).toBeUndefined();
    });
  });

  describe("respond_to_offer", () => {
    it("sends acceptance via inngest when accepted", async () => {
      mockInngestSend.mockResolvedValue(undefined as never);

      const result = await executeAction(
        "respond_to_offer",
        { accepted: true },
        undefined,
        STAFF_ID,
        BIZ_ID,
        "yes",
        { pendingOffer: { coverRequestId: "cr-1", candidateStaffId: STAFF_ID }, latestSubmission: null },
      );

      expect(result.reply).toContain("noted you're available");
      expect(mockInngestSend).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "cover/offer.responded",
          data: { coverRequestId: "cr-1", candidateStaffId: STAFF_ID, accepted: true },
        }),
      );
    });

    it("returns nothing-to-respond when no pending offer", async () => {
      const result = await executeAction(
        "respond_to_offer",
        { accepted: true },
        undefined,
        STAFF_ID,
        BIZ_ID,
        "yes",
        emptyContext,
      );

      expect(result.reply).toBe("Nothing to respond to right now.");
    });
  });

  describe("confirm_availability", () => {
    it("confirms when there's an unconfirmed submission", async () => {
      const result = await executeAction(
        "confirm_availability",
        {},
        undefined,
        STAFF_ID,
        BIZ_ID,
        "yes",
        { pendingOffer: null, latestSubmission: { id: "sub-1", status: "submitted" } },
      );

      expect(result.reply).toBe("Availability confirmed!");
    });

    it("returns nothing-to-confirm when no submission", async () => {
      const result = await executeAction(
        "confirm_availability",
        {},
        undefined,
        STAFF_ID,
        BIZ_ID,
        "confirm",
        emptyContext,
      );

      expect(result.reply).toBe("Nothing to confirm right now.");
    });
  });

  describe("query_schedule", () => {
    it("delegates to handleScheduleQuery", async () => {
      mockHandleScheduleQuery.mockResolvedValue("Your schedule: Mon 9-5");

      const result = await executeAction(
        "query_schedule",
        {},
        undefined,
        STAFF_ID,
        BIZ_ID,
        "when do I work",
        emptyContext,
      );

      expect(result.reply).toBe("Your schedule: Mon 9-5");
      expect(result.replyMarkup).toBeUndefined();
    });
  });

  describe("check_status", () => {
    it("delegates to handleStatusQuery", async () => {
      mockHandleStatusQuery.mockResolvedValue("Status: confirmed");

      const result = await executeAction(
        "check_status",
        {},
        undefined,
        STAFF_ID,
        BIZ_ID,
        "what did I submit",
        emptyContext,
      );

      expect(result.reply).toBe("Status: confirmed");
      expect(result.replyMarkup).toBeUndefined();
    });
  });

  describe("unknown", () => {
    it("returns quick-action buttons", async () => {
      const result = await executeAction(
        "unknown",
        {},
        undefined,
        STAFF_ID,
        BIZ_ID,
        "asdfghjkl",
        emptyContext,
      );

      expect(result.reply).toContain("didn't understand");
      expect(result.replyMarkup).toBeDefined();
      const buttons = result.replyMarkup!.inline_keyboard[0];
      expect(buttons).toHaveLength(3);
      expect(buttons[0].callback_data).toBe("action_schedule");
      expect(buttons[1].callback_data).toBe("action_status");
      expect(buttons[2].callback_data).toBe("action_help");
    });
  });
});
