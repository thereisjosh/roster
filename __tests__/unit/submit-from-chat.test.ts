import { describe, it, expect, vi, beforeEach } from "vitest";

// Track the set/values calls to inspect merged slots
let capturedSet: Record<string, unknown> | null = null;
let capturedValues: Record<string, unknown> | null = null;
const mocks = vi.hoisted(() => {
  const mockFindFirst = vi.fn();
  const mockReturning = vi.fn();
  const mockDb = {
    query: {
      availabilitySubmission: {
        findFirst: (...args: unknown[]) => mockFindFirst(...args),
      },
    },
    update: vi.fn(() => ({
      set: vi.fn((data: Record<string, unknown>) => {
        capturedSet = data;
        return {
          where: vi.fn(() => ({
            returning: mockReturning,
          })),
        };
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((data: Record<string, unknown>) => {
        capturedValues = data;
        return {
          onConflictDoUpdate: vi.fn(() => ({
            returning: mockReturning,
          })),
        };
      }),
    })),
  };
  return { mockDb, mockFindFirst, mockReturning };
});

vi.mock("@/lib/db", () => ({
  db: {
    ...mocks.mockDb,
    transaction: vi.fn((callback) => callback(mocks.mockDb)),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  availabilitySubmission: { id: "id", staffId: "staff_id", weekStart: "week_start" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
  and: (...args: unknown[]) => ({ op: "and", args }),
}));

import { upsertAvailability } from "@/lib/availability/submit-from-chat";

describe("upsertAvailability", () => {
  const weekStart = new Date("2026-05-04");
  const staffId = "staff-1";

  beforeEach(() => {
    mocks.mockFindFirst.mockReset();
    mocks.mockReturning.mockReset();
    capturedSet = null;
    capturedValues = null;
  });

  it("no existing submission → creates new with all incoming slots", async () => {
    mocks.mockFindFirst.mockResolvedValue(null);

    const slots = [
      { day: "2026-05-04", startTime: "09:00", endTime: "17:00", preference: "available" },
      { day: "2026-05-05", startTime: "09:00", endTime: "17:00", preference: "available" },
    ];

    const created = { id: "sub-1", staffId, weekStart, slots, status: "submitted" };
    mocks.mockReturning.mockResolvedValue([created]);

    const result = await upsertAvailability(staffId, weekStart, slots);

    expect(result).toEqual(created);
    expect(capturedValues).toBeTruthy();
    expect((capturedValues as Record<string, unknown>).slots).toEqual(slots);
    expect((capturedValues as Record<string, unknown>).status).toBe("submitted");
  });

  it("existing Mon-Fri slots + new Saturday slot → merged result has all 6 days", async () => {
    const existingSlots = [
      { day: "2026-05-04", startTime: "09:00", endTime: "17:00", preference: "available" },
      { day: "2026-05-05", startTime: "09:00", endTime: "17:00", preference: "available" },
      { day: "2026-05-06", startTime: "09:00", endTime: "17:00", preference: "available" },
      { day: "2026-05-07", startTime: "09:00", endTime: "17:00", preference: "available" },
      { day: "2026-05-08", startTime: "09:00", endTime: "17:00", preference: "available" },
    ];
    mocks.mockFindFirst.mockResolvedValue({ id: "sub-1", staffId, weekStart, slots: existingSlots });

    const newSlots = [
      { day: "2026-05-09", startTime: "10:00", endTime: "14:00", preference: "available" },
    ];

    mocks.mockReturning.mockResolvedValue([{ id: "sub-1", status: "submitted" }]);

    await upsertAvailability(staffId, weekStart, newSlots);

    expect(capturedSet).toBeTruthy();
    expect((capturedSet as Record<string, unknown>).slots).toHaveLength(6);
    expect((capturedSet as Record<string, unknown>).status).toBe("submitted");
  });

  it("existing Monday 9-5 + new Monday 10-6 → Monday overridden, other days kept", async () => {
    const existingSlots = [
      { day: "2026-05-04", startTime: "09:00", endTime: "17:00", preference: "available" },
      { day: "2026-05-05", startTime: "09:00", endTime: "17:00", preference: "available" },
    ];
    mocks.mockFindFirst.mockResolvedValue({ id: "sub-1", staffId, weekStart, slots: existingSlots });

    const newSlots = [
      { day: "2026-05-04", startTime: "10:00", endTime: "18:00", preference: "available" },
    ];

    mocks.mockReturning.mockResolvedValue([{ id: "sub-1", status: "submitted" }]);

    await upsertAvailability(staffId, weekStart, newSlots);

    const slots = (capturedSet as Record<string, unknown>).slots as Array<Record<string, string>>;
    expect(slots).toHaveLength(2);
    // Sorted by day: Monday first, then Tuesday
    expect(slots[0]).toEqual({
      day: "2026-05-04",
      startTime: "10:00",
      endTime: "18:00",
      preference: "available",
    });
    expect(slots[1]).toEqual({
      day: "2026-05-05",
      startTime: "09:00",
      endTime: "17:00",
      preference: "available",
    });
    expect((capturedSet as Record<string, unknown>).status).toBe("submitted");
  });
});
