import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database module before importing assembler
vi.mock("@/lib/db", () => ({
  db: {
    query: {
      business: { findFirst: vi.fn() },
      staff: { findMany: vi.fn() },
      availabilitySubmission: { findMany: vi.fn() },
      preferenceRule: { findMany: vi.fn() },
      knowledgePage: { findMany: vi.fn() },
      staffRelationship: { findMany: vi.fn() },
      staffSkill: { findMany: vi.fn() },
      shiftCompositionRule: { findMany: vi.fn() },
    },
  },
}));

import { db } from "@/lib/db";
import { assembleScheduleInput } from "@/lib/scheduling/assembler";

const mockBusiness = {
  id: "biz-1",
  name: "Kopi Corner",
  config: {
    weekStartDay: 1,
    availabilityDeadlineDay: 5,
    availabilityDeadlineHour: 18,
    reminderIntervals: [48, 24],
    coverageRequirements: [
      { role: "barista", days: [0, 1, 2, 3, 4, 5, 6], startTime: "07:00", endTime: "15:00", minStaff: 1 },
      { role: "barista", days: [0, 1, 2, 3, 4, 5, 6], startTime: "15:00", endTime: "22:00", minStaff: 1 },
    ],
    maxConsecutiveDays: 6,
    minRestHoursBetweenShifts: 10,
    fullTimeHours: { min: 35, target: 40, max: 44 },
    costWeight: 0.25,
    fairnessWeight: 0.25,
    preferenceWeight: 0.35,
  },
};

const mockStaff = [
  {
    id: "s1",
    businessId: "biz-1",
    name: "Aisha",
    employmentType: "full_time" as const,
    roles: ["barista"],
    payStructure: { baseHourlyRate: 12 },
    isActive: true,
  },
  {
    id: "s2",
    businessId: "biz-1",
    name: "Ben",
    employmentType: "part_time" as const,
    roles: ["barista"],
    payStructure: { baseHourlyRate: 10 },
    isActive: true,
  },
];

const weekStart = new Date("2025-01-06T00:00:00Z"); // Monday

beforeEach(() => {
  vi.clearAllMocks();
});

describe("assembleScheduleInput", () => {
  it("assembles staff data correctly", async () => {
    vi.mocked(db.query.business.findFirst).mockResolvedValue(mockBusiness as any);
    vi.mocked(db.query.staff.findMany).mockResolvedValue(mockStaff as any);
    vi.mocked(db.query.availabilitySubmission.findMany).mockResolvedValue([]);
    vi.mocked(db.query.preferenceRule.findMany).mockResolvedValue([]);
    vi.mocked(db.query.knowledgePage.findMany).mockResolvedValue([]);
    vi.mocked(db.query.staffRelationship.findMany).mockResolvedValue([]);
    vi.mocked(db.query.staffSkill.findMany).mockResolvedValue([]);
    vi.mocked(db.query.shiftCompositionRule.findMany).mockResolvedValue([]);

    const result = await assembleScheduleInput("biz-1", weekStart);

    expect(result.input.staff).toHaveLength(2);
    expect(result.input.staff[0]).toEqual({
      id: "s1",
      qualifications: ["barista"],
      maxWeeklyHours: 44,
      hourlyRate: 12,
      employmentType: "full-time",
      level: "L1",
      unavailable: [],
      availability: [],
    });
    // Part-time staff gets 30h max
    expect(result.input.staff[1].maxWeeklyHours).toBe(30);
  });

  it("expands coverage requirements for all 7 days of the week", async () => {
    vi.mocked(db.query.business.findFirst).mockResolvedValue(mockBusiness as any);
    vi.mocked(db.query.staff.findMany).mockResolvedValue(mockStaff as any);
    vi.mocked(db.query.availabilitySubmission.findMany).mockResolvedValue([]);
    vi.mocked(db.query.preferenceRule.findMany).mockResolvedValue([]);
    vi.mocked(db.query.knowledgePage.findMany).mockResolvedValue([]);
    vi.mocked(db.query.staffRelationship.findMany).mockResolvedValue([]);
    vi.mocked(db.query.staffSkill.findMany).mockResolvedValue([]);
    vi.mocked(db.query.shiftCompositionRule.findMany).mockResolvedValue([]);

    const result = await assembleScheduleInput("biz-1", weekStart);

    // 2 coverage requirements x 7 days = 14 shifts
    expect(result.input.shifts).toHaveLength(14);
    // First shift should be Monday morning
    expect(result.input.shifts[0].id).toBe("2025-01-06-barista-07:00");
    expect(result.input.shifts[0].date).toBe("2025-01-06");
    expect(result.input.shifts[0].startTime).toBe("07:00");
    expect(result.input.shifts[0].endTime).toBe("15:00");
  });

  it("maps unavailability from submissions", async () => {
    vi.mocked(db.query.business.findFirst).mockResolvedValue(mockBusiness as any);
    vi.mocked(db.query.staff.findMany).mockResolvedValue(mockStaff as any);
    vi.mocked(db.query.availabilitySubmission.findMany).mockResolvedValue([
      {
        id: "sub-1",
        staffId: "s2",
        weekStart,
        status: "submitted",
        slots: [
          { day: "2025-01-11", startTime: "07:00", endTime: "22:00", preference: "unavailable" as const },
        ],
        submittedAt: new Date(),
        createdAt: new Date(),
      },
    ] as any);
    vi.mocked(db.query.preferenceRule.findMany).mockResolvedValue([]);
    vi.mocked(db.query.knowledgePage.findMany).mockResolvedValue([]);
    vi.mocked(db.query.staffRelationship.findMany).mockResolvedValue([]);
    vi.mocked(db.query.staffSkill.findMany).mockResolvedValue([]);
    vi.mocked(db.query.shiftCompositionRule.findMany).mockResolvedValue([]);

    const result = await assembleScheduleInput("biz-1", weekStart);

    const ben = result.input.staff.find((s) => s.id === "s2");
    // Ben is unavailable all day Saturday — should cover both coverage requirement shifts
    expect(ben?.unavailable).toContain("2025-01-11-barista-07:00");
    expect(ben?.unavailable).toContain("2025-01-11-barista-15:00");
  });

  it("includes preference rules in output", async () => {
    vi.mocked(db.query.business.findFirst).mockResolvedValue(mockBusiness as any);
    vi.mocked(db.query.staff.findMany).mockResolvedValue(mockStaff as any);
    vi.mocked(db.query.availabilitySubmission.findMany).mockResolvedValue([]);
    vi.mocked(db.query.preferenceRule.findMany).mockResolvedValue([
      {
        id: "r1",
        businessId: "biz-1",
        ruleText: "Aisha prefers morning shifts",
        ruleType: "soft" as const,
        source: "manager_explicit" as const,
        confidence: 0.9,
        active: true,
        expiresAt: null,
        createdAt: new Date(),
      },
    ] as any);
    vi.mocked(db.query.knowledgePage.findMany).mockResolvedValue([]);
    vi.mocked(db.query.staffRelationship.findMany).mockResolvedValue([]);
    vi.mocked(db.query.staffSkill.findMany).mockResolvedValue([]);
    vi.mocked(db.query.shiftCompositionRule.findMany).mockResolvedValue([]);

    const result = await assembleScheduleInput("biz-1", weekStart);

    expect(result.preferenceRules).toHaveLength(1);
    expect(result.preferenceRules[0].ruleText).toBe("Aisha prefers morning shifts");
    expect(result.preferenceRules[0].ruleType).toBe("soft");
  });

  it("includes configured weights", async () => {
    vi.mocked(db.query.business.findFirst).mockResolvedValue(mockBusiness as any);
    vi.mocked(db.query.staff.findMany).mockResolvedValue(mockStaff as any);
    vi.mocked(db.query.availabilitySubmission.findMany).mockResolvedValue([]);
    vi.mocked(db.query.preferenceRule.findMany).mockResolvedValue([]);
    vi.mocked(db.query.knowledgePage.findMany).mockResolvedValue([]);
    vi.mocked(db.query.staffRelationship.findMany).mockResolvedValue([]);
    vi.mocked(db.query.staffSkill.findMany).mockResolvedValue([]);
    vi.mocked(db.query.shiftCompositionRule.findMany).mockResolvedValue([]);

    const result = await assembleScheduleInput("biz-1", weekStart);

    expect(result.weights).toEqual({
      costWeight: 0.25,
      fairnessWeight: 0.25,
      preferenceWeight: 0.35,
    });
  });

  it("includes staff names map", async () => {
    vi.mocked(db.query.business.findFirst).mockResolvedValue(mockBusiness as any);
    vi.mocked(db.query.staff.findMany).mockResolvedValue(mockStaff as any);
    vi.mocked(db.query.availabilitySubmission.findMany).mockResolvedValue([]);
    vi.mocked(db.query.preferenceRule.findMany).mockResolvedValue([]);
    vi.mocked(db.query.knowledgePage.findMany).mockResolvedValue([]);
    vi.mocked(db.query.staffRelationship.findMany).mockResolvedValue([]);
    vi.mocked(db.query.staffSkill.findMany).mockResolvedValue([]);
    vi.mocked(db.query.shiftCompositionRule.findMany).mockResolvedValue([]);

    const result = await assembleScheduleInput("biz-1", weekStart);

    expect(result.staffNames.get("s1")).toBe("Aisha");
    expect(result.staffNames.get("s2")).toBe("Ben");
  });

  it("sets constraints from business config", async () => {
    vi.mocked(db.query.business.findFirst).mockResolvedValue(mockBusiness as any);
    vi.mocked(db.query.staff.findMany).mockResolvedValue(mockStaff as any);
    vi.mocked(db.query.availabilitySubmission.findMany).mockResolvedValue([]);
    vi.mocked(db.query.preferenceRule.findMany).mockResolvedValue([]);
    vi.mocked(db.query.knowledgePage.findMany).mockResolvedValue([]);
    vi.mocked(db.query.staffRelationship.findMany).mockResolvedValue([]);
    vi.mocked(db.query.staffSkill.findMany).mockResolvedValue([]);
    vi.mocked(db.query.shiftCompositionRule.findMany).mockResolvedValue([]);

    const result = await assembleScheduleInput("biz-1", weekStart);

    expect(result.input.constraints).toEqual({
      minRestHours: 10,
      maxConsecutiveDays: 6,
    });
  });

  it("throws when business not found", async () => {
    vi.mocked(db.query.business.findFirst).mockResolvedValue(undefined);

    await expect(assembleScheduleInput("missing", weekStart)).rejects.toThrow(
      "Business missing not found",
    );
  });

  it("throws when no active staff", async () => {
    vi.mocked(db.query.business.findFirst).mockResolvedValue(mockBusiness as any);
    vi.mocked(db.query.staff.findMany).mockResolvedValue([]);

    await expect(assembleScheduleInput("biz-1", weekStart)).rejects.toThrow(
      "No active staff found",
    );
  });
});
