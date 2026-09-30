import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// Mock the db module before importing the router
vi.mock("@/lib/db", () => {
  const mockDb = {
    query: {
      staff: {
        findMany: vi.fn(),
      },
      availabilitySubmission: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
    },
    insert: vi.fn(),
    update: vi.fn(),
  };
  return { db: mockDb, getDb: () => mockDb };
});

vi.mock("@/lib/llm/schedule-client", () => ({
  callScheduleGeneration: vi.fn(),
}));

import { appRouter } from "@/lib/trpc/router";
import { createCallerFactory } from "@/lib/trpc/init";
import { db } from "@/lib/db";

const createCaller = createCallerFactory(appRouter);

// Valid UUIDs for test data
const STAFF_ID = "00000000-0000-4000-8000-000000000001";

function authedCtx(overrides: Record<string, unknown> = {}) {
  return {
    session: {
      user: {
        id: "u1",
        businessId: "b1",
        name: "Test User",
        email: "test@example.com",
        ...overrides,
      },
    },
  };
}

describe("availability router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("auth", () => {
    it("throws UNAUTHORIZED without session", async () => {
      const caller = createCaller({ session: null });
      await expect(
        caller.availability.listForWeek({ weekStart: new Date() }),
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.availability.listForWeek({ weekStart: new Date() }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("throws FORBIDDEN without businessId", async () => {
      const caller = createCaller({
        session: {
          user: { id: "u1", name: "Test", email: "t@t.com" },
        },
      });
      await expect(
        caller.availability.listForWeek({ weekStart: new Date() }),
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.availability.listForWeek({ weekStart: new Date() }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("listForWeek", () => {
    it("returns empty array when no staff exist", async () => {
      const caller = createCaller(authedCtx());
      vi.mocked(db.query.staff.findMany).mockResolvedValue([]);

      const result = await caller.availability.listForWeek({
        weekStart: new Date("2026-04-20"),
      });
      expect(result).toEqual([]);
    });

    it("returns submissions with staff data for the given week", async () => {
      const caller = createCaller(authedCtx());
      vi.mocked(db.query.staff.findMany).mockResolvedValue([
        { id: "s1" } as any,
      ]);

      const mockSubmissions = [
        {
          id: "sub1",
          staffId: "s1",
          weekStart: new Date("2026-04-20"),
          status: "submitted" as const,
          slots: [],
          staff: { id: "s1", name: "Alice" },
        },
      ];
      vi.mocked(db.query.availabilitySubmission.findMany).mockResolvedValue(
        mockSubmissions as any,
      );

      const result = await caller.availability.listForWeek({
        weekStart: new Date("2026-04-20"),
      });
      expect(result).toEqual(mockSubmissions);
      expect(db.query.availabilitySubmission.findMany).toHaveBeenCalled();
    });
  });

  describe("submit", () => {
    const mockSlots = [
      {
        day: "2026-04-20",
        startTime: "06:00",
        endTime: "14:00",
        preference: "available" as const,
      },
    ];

    it("creates new submission when none exists", async () => {
      const caller = createCaller(authedCtx());
      vi.mocked(db.query.availabilitySubmission.findFirst).mockResolvedValue(
        null as any,
      );

      const created = {
        id: "new-sub",
        staffId: STAFF_ID,
        weekStart: new Date("2026-04-20"),
        slots: mockSlots,
        status: "submitted",
        submittedAt: expect.any(Date),
      };
      const returningFn = vi.fn().mockResolvedValue([created]);
      const valuesFn = vi.fn().mockReturnValue({ returning: returningFn });
      vi.mocked(db.insert).mockReturnValue({ values: valuesFn } as any);

      const result = await caller.availability.submit({
        staffId: STAFF_ID,
        weekStart: new Date("2026-04-20"),
        slots: mockSlots,
      });

      expect(result).toEqual(created);
      expect(db.insert).toHaveBeenCalled();
    });

    it("updates existing submission (upsert behavior)", async () => {
      const caller = createCaller(authedCtx());
      vi.mocked(db.query.availabilitySubmission.findFirst).mockResolvedValue({
        id: "existing-sub",
      } as any);

      const updated = {
        id: "existing-sub",
        staffId: STAFF_ID,
        weekStart: new Date("2026-04-20"),
        slots: mockSlots,
        status: "submitted",
        submittedAt: expect.any(Date),
      };
      const returningFn = vi.fn().mockResolvedValue([updated]);
      const whereFn = vi.fn().mockReturnValue({ returning: returningFn });
      const setFn = vi.fn().mockReturnValue({ where: whereFn });
      vi.mocked(db.update).mockReturnValue({ set: setFn } as any);

      const result = await caller.availability.submit({
        staffId: STAFF_ID,
        weekStart: new Date("2026-04-20"),
        slots: mockSlots,
      });

      expect(result).toEqual(updated);
      expect(db.update).toHaveBeenCalled();
    });

    it('sets status to "submitted" and submittedAt timestamp', async () => {
      const caller = createCaller(authedCtx());
      vi.mocked(db.query.availabilitySubmission.findFirst).mockResolvedValue(
        null as any,
      );

      const returningFn = vi.fn().mockResolvedValue([{ id: "new" }]);
      const valuesFn = vi.fn().mockReturnValue({ returning: returningFn });
      vi.mocked(db.insert).mockReturnValue({ values: valuesFn } as any);

      await caller.availability.submit({
        staffId: STAFF_ID,
        weekStart: new Date("2026-04-20"),
        slots: mockSlots,
      });

      const insertedValues = valuesFn.mock.calls[0][0];
      expect(insertedValues.status).toBe("submitted");
      expect(insertedValues.submittedAt).toBeInstanceOf(Date);
    });

    it("stores slots array correctly", async () => {
      const caller = createCaller(authedCtx());
      vi.mocked(db.query.availabilitySubmission.findFirst).mockResolvedValue(
        null as any,
      );

      const returningFn = vi.fn().mockResolvedValue([{ id: "new" }]);
      const valuesFn = vi.fn().mockReturnValue({ returning: returningFn });
      vi.mocked(db.insert).mockReturnValue({ values: valuesFn } as any);

      await caller.availability.submit({
        staffId: STAFF_ID,
        weekStart: new Date("2026-04-20"),
        slots: mockSlots,
      });

      const insertedValues = valuesFn.mock.calls[0][0];
      expect(insertedValues.slots).toEqual(mockSlots);
    });
  });
});
