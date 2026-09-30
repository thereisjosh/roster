import { describe, it, expect } from "vitest";
import {
  checkCoverage,
  checkQualifications,
  checkHoursCompliance,
  checkAvailability,
  checkRestPeriods,
  checkConsecutiveDays,
  checkHourlyCoverage,
  checkShiftComposition,
  isAvailableForShift,
  computeAssignmentWindow,
  validateHardConstraints,
  parseTimeToHours,
  shiftWorkedHours,
  assignmentWorkedHours,
  calculateGini,
  type ScheduleInput,
  type ScheduleOutput,
  type Shift,
  type Staff,
} from "@/lib/scheduling/validator";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseInput: ScheduleInput = {
  shifts: [
    { id: "mon-am", date: "2025-01-06", startTime: "07:00", endTime: "15:00", requiredRole: "barista", minStaff: 1 },
    { id: "mon-pm", date: "2025-01-06", startTime: "15:00", endTime: "22:00", requiredRole: "barista", minStaff: 1 },
    { id: "tue-am", date: "2025-01-07", startTime: "07:00", endTime: "15:00", requiredRole: "barista", minStaff: 1 },
  ],
  staff: [
    { id: "s1", qualifications: ["barista"], maxWeeklyHours: 44, hourlyRate: 12, unavailable: [] },
    { id: "s2", qualifications: ["barista"], maxWeeklyHours: 20, hourlyRate: 10, unavailable: ["mon-pm"] },
    { id: "s3", qualifications: ["cashier"], maxWeeklyHours: 44, hourlyRate: 11, unavailable: [] },
  ],
  constraints: { minRestHours: 10, maxConsecutiveDays: 6 },
};

// ---------------------------------------------------------------------------
// parseTimeToHours
// ---------------------------------------------------------------------------

describe("parseTimeToHours", () => {
  it("parses whole hours", () => {
    expect(parseTimeToHours("07:00")).toBe(7);
    expect(parseTimeToHours("22:00")).toBe(22);
  });

  it("parses minutes as fractions", () => {
    expect(parseTimeToHours("07:30")).toBe(7.5);
    expect(parseTimeToHours("15:45")).toBe(15.75);
  });

  it("parses midnight", () => {
    expect(parseTimeToHours("00:00")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// calculateGini
// ---------------------------------------------------------------------------

describe("calculateGini", () => {
  it("returns 0 for empty array", () => {
    expect(calculateGini([])).toBe(0);
  });

  it("returns 0 for equal values", () => {
    expect(calculateGini([10, 10, 10])).toBe(0);
  });

  it("returns 0 for all zeros", () => {
    expect(calculateGini([0, 0, 0])).toBe(0);
  });

  it("returns positive value for unequal distribution", () => {
    const gini = calculateGini([0, 0, 100]);
    expect(gini).toBeGreaterThan(0);
    expect(gini).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// shiftWorkedHours
// ---------------------------------------------------------------------------

describe("shiftWorkedHours", () => {
  it("returns gross hours when no breakMinutes", () => {
    const shift = { id: "s1", date: "2025-01-06", startTime: "11:00", endTime: "21:00", requiredRole: "barista", minStaff: 1 };
    expect(shiftWorkedHours(shift)).toBe(10);
  });

  it("deducts breakMinutes from gross hours", () => {
    const shift = { id: "s1", date: "2025-01-06", startTime: "11:00", endTime: "21:00", requiredRole: "chef", minStaff: 1, breakMinutes: 120 };
    expect(shiftWorkedHours(shift)).toBe(8);
  });

  it("handles breakMinutes of 0", () => {
    const shift = { id: "s1", date: "2025-01-06", startTime: "09:00", endTime: "15:00", requiredRole: "barista", minStaff: 1, breakMinutes: 0 };
    expect(shiftWorkedHours(shift)).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// assignmentWorkedHours
// ---------------------------------------------------------------------------

describe("assignmentWorkedHours", () => {
  const kitchenShift = { id: "mon-kitchen", date: "2025-01-06", startTime: "11:00", endTime: "21:00", requiredRole: "chef", minStaff: 1, breakMinutes: 120 };

  it("falls back to shift times when no assignment overrides", () => {
    const assignment = { shiftId: "mon-kitchen", staffId: "chef1" };
    // 11:00-21:00 = 10h gross - 2h break = 8h
    expect(assignmentWorkedHours(assignment, kitchenShift)).toBe(8);
  });

  it("uses assignment-level times when present", () => {
    const assignment = { shiftId: "mon-kitchen", staffId: "chef1", startTime: "13:00", endTime: "20:30" };
    // 13:00-20:30 = 7.5h gross - 2h break = 5.5h
    expect(assignmentWorkedHours(assignment, kitchenShift)).toBe(5.5);
  });

  it("deducts breakMinutes from assignment-level hours", () => {
    const assignment = { shiftId: "mon-kitchen", staffId: "chef1", startTime: "11:00", endTime: "20:00" };
    // 11:00-20:00 = 9h gross - 2h break = 7h
    expect(assignmentWorkedHours(assignment, kitchenShift)).toBe(7);
  });

  it("handles shift with no breakMinutes", () => {
    const baristaShift = { id: "mon-lunch", date: "2025-01-06", startTime: "11:00", endTime: "15:00", requiredRole: "barista", minStaff: 1 };
    const assignment = { shiftId: "mon-lunch", staffId: "b1" };
    expect(assignmentWorkedHours(assignment, baristaShift)).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// checkCoverage
// ---------------------------------------------------------------------------

describe("checkCoverage", () => {
  it("passes when all shifts have enough staff", () => {
    const output: ScheduleOutput = {
      assignments: [
        { shiftId: "mon-am", staffId: "s1" },
        { shiftId: "mon-pm", staffId: "s1" },
        { shiftId: "tue-am", staffId: "s1" },
      ],
    };
    const result = checkCoverage(baseInput, output);
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("fails when a shift has no staff", () => {
    const output: ScheduleOutput = {
      assignments: [
        { shiftId: "mon-am", staffId: "s1" },
        { shiftId: "mon-pm", staffId: "s1" },
        // tue-am missing
      ],
    };
    const result = checkCoverage(baseInput, output);
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toContain("tue-am");
  });

  it("fails when shift has fewer staff than minStaff", () => {
    const input: ScheduleInput = {
      ...baseInput,
      shifts: [
        { id: "mon-am", date: "2025-01-06", startTime: "07:00", endTime: "15:00", requiredRole: "barista", minStaff: 2 },
      ],
    };
    const output: ScheduleOutput = {
      assignments: [{ shiftId: "mon-am", staffId: "s1" }],
    };
    const result = checkCoverage(input, output);
    expect(result.passed).toBe(false);
    expect(result.violations[0]).toContain("needs 2 staff, got 1");
  });
});

// ---------------------------------------------------------------------------
// checkQualifications
// ---------------------------------------------------------------------------

describe("checkQualifications", () => {
  it("passes when all assignments match qualifications", () => {
    const output: ScheduleOutput = {
      assignments: [{ shiftId: "mon-am", staffId: "s1" }], // s1 is barista, shift requires barista
    };
    const result = checkQualifications(baseInput, output);
    expect(result.passed).toBe(true);
  });

  it("fails when staff lacks required qualification", () => {
    const output: ScheduleOutput = {
      assignments: [{ shiftId: "mon-am", staffId: "s3" }], // s3 is cashier, shift requires barista
    };
    const result = checkQualifications(baseInput, output);
    expect(result.passed).toBe(false);
    expect(result.violations[0]).toContain("not qualified for barista");
  });
});

// ---------------------------------------------------------------------------
// checkHoursCompliance
// ---------------------------------------------------------------------------

describe("checkHoursCompliance", () => {
  it("passes when staff under max hours", () => {
    const output: ScheduleOutput = {
      assignments: [
        { shiftId: "mon-am", staffId: "s1" }, // 8h
        { shiftId: "mon-pm", staffId: "s1" }, // 7h
        { shiftId: "tue-am", staffId: "s1" }, // 8h = 23h total, under 44h
      ],
    };
    const result = checkHoursCompliance(baseInput, output);
    expect(result.passed).toBe(true);
  });

  it("fails when staff exceeds max hours", () => {
    // s2 has maxWeeklyHours=20, each shift is ~7-8h
    const output: ScheduleOutput = {
      assignments: [
        { shiftId: "mon-am", staffId: "s2" }, // 8h
        { shiftId: "mon-pm", staffId: "s2" }, // 7h
        { shiftId: "tue-am", staffId: "s2" }, // 8h = 23h > 20h
      ],
    };
    const result = checkHoursCompliance(baseInput, output);
    expect(result.passed).toBe(false);
    expect(result.violations[0]).toContain("s2");
    expect(result.violations[0]).toContain("max is 20h");
  });

  it("deducts breakMinutes from worked hours", () => {
    // 10h shift with 120min break = 8h worked, staff has max 9h
    const input: ScheduleInput = {
      shifts: [
        { id: "kitchen", date: "2025-01-06", startTime: "11:00", endTime: "21:00", requiredRole: "chef", minStaff: 1, breakMinutes: 120 },
      ],
      staff: [
        { id: "chef1", qualifications: ["chef"], maxWeeklyHours: 9, hourlyRate: 15, unavailable: [] },
      ],
      constraints: { minRestHours: 10, maxConsecutiveDays: 6 },
    };
    const output: ScheduleOutput = {
      assignments: [{ shiftId: "kitchen", staffId: "chef1" }],
    };
    // Without break deduction: 10h > 9h max (would fail)
    // With break deduction: 8h < 9h max (should pass)
    const result = checkHoursCompliance(input, output);
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("fails when worked hours exceed max even with break deduction", () => {
    // 10h shift with 60min break = 9h worked, staff has max 8h
    const input: ScheduleInput = {
      shifts: [
        { id: "kitchen", date: "2025-01-06", startTime: "11:00", endTime: "21:00", requiredRole: "chef", minStaff: 1, breakMinutes: 60 },
      ],
      staff: [
        { id: "chef1", qualifications: ["chef"], maxWeeklyHours: 8, hourlyRate: 15, unavailable: [] },
      ],
      constraints: { minRestHours: 10, maxConsecutiveDays: 6 },
    };
    const output: ScheduleOutput = {
      assignments: [{ shiftId: "kitchen", staffId: "chef1" }],
    };
    const result = checkHoursCompliance(input, output);
    expect(result.passed).toBe(false);
    expect(result.violations[0]).toContain("chef1");
  });
});

// ---------------------------------------------------------------------------
// checkAvailability
// ---------------------------------------------------------------------------

describe("checkAvailability", () => {
  it("passes when no one assigned to unavailable shift", () => {
    const output: ScheduleOutput = {
      assignments: [{ shiftId: "mon-am", staffId: "s2" }], // s2 is unavailable for mon-pm, not mon-am
    };
    const result = checkAvailability(baseInput, output);
    expect(result.passed).toBe(true);
  });

  it("fails when staff assigned to unavailable shift", () => {
    const output: ScheduleOutput = {
      assignments: [{ shiftId: "mon-pm", staffId: "s2" }], // s2 is unavailable for mon-pm
    };
    const result = checkAvailability(baseInput, output);
    expect(result.passed).toBe(false);
    expect(result.violations[0]).toContain("s2");
    expect(result.violations[0]).toContain("mon-pm");
  });
});

// ---------------------------------------------------------------------------
// checkRestPeriods
// ---------------------------------------------------------------------------

describe("checkRestPeriods", () => {
  it("passes when rest period is sufficient", () => {
    // mon-pm ends 22:00, tue-am starts 07:00 = 9h rest, but minRest is 10
    // Let's use shifts with enough gap
    const input: ScheduleInput = {
      shifts: [
        { id: "mon-am", date: "2025-01-06", startTime: "07:00", endTime: "15:00", requiredRole: "barista", minStaff: 1 },
        { id: "tue-am", date: "2025-01-07", startTime: "07:00", endTime: "15:00", requiredRole: "barista", minStaff: 1 },
      ],
      staff: [{ id: "s1", qualifications: ["barista"], maxWeeklyHours: 44, hourlyRate: 12, unavailable: [] }],
      constraints: { minRestHours: 10, maxConsecutiveDays: 6 },
    };
    const output: ScheduleOutput = {
      assignments: [
        { shiftId: "mon-am", staffId: "s1" }, // ends 15:00 Mon
        { shiftId: "tue-am", staffId: "s1" }, // starts 07:00 Tue = 16h rest
      ],
    };
    const result = checkRestPeriods(input, output);
    expect(result.passed).toBe(true);
  });

  it("skips rest check for same-day consecutive shifts (continuous work block)", () => {
    const input: ScheduleInput = {
      shifts: [
        { id: "mon-lunch", date: "2025-01-06", startTime: "11:00", endTime: "15:00", requiredRole: "barista", minStaff: 1 },
        { id: "mon-dinner", date: "2025-01-06", startTime: "15:00", endTime: "21:00", requiredRole: "barista", minStaff: 1 },
      ],
      staff: [{ id: "s1", qualifications: ["barista"], maxWeeklyHours: 44, hourlyRate: 12, unavailable: [] }],
      constraints: { minRestHours: 10, maxConsecutiveDays: 6 },
    };
    const output: ScheduleOutput = {
      assignments: [
        { shiftId: "mon-lunch", staffId: "s1" },
        { shiftId: "mon-dinner", staffId: "s1" },
      ],
    };
    const result = checkRestPeriods(input, output);
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("fails when rest period is insufficient", () => {
    const input: ScheduleInput = {
      shifts: [
        { id: "mon-pm", date: "2025-01-06", startTime: "15:00", endTime: "22:00", requiredRole: "barista", minStaff: 1 },
        { id: "tue-am", date: "2025-01-07", startTime: "07:00", endTime: "15:00", requiredRole: "barista", minStaff: 1 },
      ],
      staff: [{ id: "s1", qualifications: ["barista"], maxWeeklyHours: 44, hourlyRate: 12, unavailable: [] }],
      constraints: { minRestHours: 10, maxConsecutiveDays: 6 },
    };
    const output: ScheduleOutput = {
      assignments: [
        { shiftId: "mon-pm", staffId: "s1" }, // ends 22:00 Mon
        { shiftId: "tue-am", staffId: "s1" }, // starts 07:00 Tue = 9h rest < 10h min
      ],
    };
    const result = checkRestPeriods(input, output);
    expect(result.passed).toBe(false);
    expect(result.violations[0]).toContain("only 9h rest");
  });
});

// ---------------------------------------------------------------------------
// checkConsecutiveDays
// ---------------------------------------------------------------------------

describe("checkConsecutiveDays", () => {
  // A full week of shifts: Mon 2025-01-06 → Sun 2025-01-12, AM + PM each day
  const weekShifts = [
    { id: "mon-am", date: "2025-01-06", startTime: "07:00", endTime: "15:00", requiredRole: "barista", minStaff: 1 },
    { id: "mon-pm", date: "2025-01-06", startTime: "15:00", endTime: "22:00", requiredRole: "barista", minStaff: 1 },
    { id: "tue-am", date: "2025-01-07", startTime: "07:00", endTime: "15:00", requiredRole: "barista", minStaff: 1 },
    { id: "tue-pm", date: "2025-01-07", startTime: "15:00", endTime: "22:00", requiredRole: "barista", minStaff: 1 },
    { id: "wed-am", date: "2025-01-08", startTime: "07:00", endTime: "15:00", requiredRole: "barista", minStaff: 1 },
    { id: "wed-pm", date: "2025-01-08", startTime: "15:00", endTime: "22:00", requiredRole: "barista", minStaff: 1 },
    { id: "thu-am", date: "2025-01-09", startTime: "07:00", endTime: "15:00", requiredRole: "barista", minStaff: 1 },
    { id: "thu-pm", date: "2025-01-09", startTime: "15:00", endTime: "22:00", requiredRole: "barista", minStaff: 1 },
    { id: "fri-am", date: "2025-01-10", startTime: "07:00", endTime: "15:00", requiredRole: "barista", minStaff: 1 },
    { id: "fri-pm", date: "2025-01-10", startTime: "15:00", endTime: "22:00", requiredRole: "barista", minStaff: 1 },
    { id: "sat-am", date: "2025-01-11", startTime: "07:00", endTime: "15:00", requiredRole: "barista", minStaff: 1 },
    { id: "sat-pm", date: "2025-01-11", startTime: "15:00", endTime: "22:00", requiredRole: "barista", minStaff: 1 },
    { id: "sun-am", date: "2025-01-12", startTime: "07:00", endTime: "15:00", requiredRole: "barista", minStaff: 1 },
    { id: "sun-pm", date: "2025-01-12", startTime: "15:00", endTime: "22:00", requiredRole: "barista", minStaff: 1 },
  ];

  const weekInput: ScheduleInput = {
    shifts: weekShifts,
    staff: [
      { id: "s1", qualifications: ["barista"], maxWeeklyHours: 44, hourlyRate: 12, unavailable: [] },
      { id: "s2", qualifications: ["barista"], maxWeeklyHours: 44, hourlyRate: 10, unavailable: [] },
    ],
    constraints: { minRestHours: 10, maxConsecutiveDays: 6 },
  };

  it("passes when staff work ≤ maxConsecutiveDays", () => {
    // s1 works Mon-Fri = 5 consecutive days, max is 6
    const output: ScheduleOutput = {
      assignments: [
        { shiftId: "mon-am", staffId: "s1" },
        { shiftId: "tue-am", staffId: "s1" },
        { shiftId: "wed-am", staffId: "s1" },
        { shiftId: "thu-am", staffId: "s1" },
        { shiftId: "fri-am", staffId: "s1" },
      ],
    };
    const result = checkConsecutiveDays(weekInput, output);
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("fails when staff exceed maxConsecutiveDays", () => {
    // s1 works Mon-Sun = 7 consecutive days, max is 6
    const output: ScheduleOutput = {
      assignments: [
        { shiftId: "mon-am", staffId: "s1" },
        { shiftId: "tue-am", staffId: "s1" },
        { shiftId: "wed-am", staffId: "s1" },
        { shiftId: "thu-am", staffId: "s1" },
        { shiftId: "fri-am", staffId: "s1" },
        { shiftId: "sat-am", staffId: "s1" },
        { shiftId: "sun-am", staffId: "s1" },
      ],
    };
    const result = checkConsecutiveDays(weekInput, output);
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toContain("s1");
    expect(result.violations[0]).toContain("7 consecutive");
  });

  it("handles non-consecutive days", () => {
    // s1 works Mon, Wed, Fri (gaps between each)
    const output: ScheduleOutput = {
      assignments: [
        { shiftId: "mon-am", staffId: "s1" },
        { shiftId: "wed-am", staffId: "s1" },
        { shiftId: "fri-am", staffId: "s1" },
      ],
    };
    const result = checkConsecutiveDays(weekInput, output);
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("handles multiple staff independently", () => {
    // s1 works 7 consecutive days (fails), s2 works 3 consecutive days (passes)
    const output: ScheduleOutput = {
      assignments: [
        { shiftId: "mon-am", staffId: "s1" },
        { shiftId: "tue-am", staffId: "s1" },
        { shiftId: "wed-am", staffId: "s1" },
        { shiftId: "thu-am", staffId: "s1" },
        { shiftId: "fri-am", staffId: "s1" },
        { shiftId: "sat-am", staffId: "s1" },
        { shiftId: "sun-am", staffId: "s1" },
        { shiftId: "mon-am", staffId: "s2" },
        { shiftId: "tue-am", staffId: "s2" },
        { shiftId: "wed-am", staffId: "s2" },
      ],
    };
    const result = checkConsecutiveDays(weekInput, output);
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toContain("s1");
  });

  it("deduplicates dates when staff has multiple shifts on the same day", () => {
    // s1 has AM + PM on Mon and Tue = 2 unique consecutive days, not 4
    const output: ScheduleOutput = {
      assignments: [
        { shiftId: "mon-am", staffId: "s1" },
        { shiftId: "mon-pm", staffId: "s1" },
        { shiftId: "tue-am", staffId: "s1" },
        { shiftId: "tue-pm", staffId: "s1" },
      ],
    };
    const result = checkConsecutiveDays(weekInput, output);
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// validateHardConstraints (combined)
// ---------------------------------------------------------------------------

describe("validateHardConstraints", () => {
  it("passes for a fully valid schedule", () => {
    const input: ScheduleInput = {
      shifts: [
        { id: "mon-am", date: "2025-01-06", startTime: "07:00", endTime: "15:00", requiredRole: "barista", minStaff: 1 },
        { id: "tue-am", date: "2025-01-07", startTime: "07:00", endTime: "15:00", requiredRole: "barista", minStaff: 1 },
      ],
      staff: [{ id: "s1", qualifications: ["barista"], maxWeeklyHours: 44, hourlyRate: 12, unavailable: [] }],
      constraints: { minRestHours: 10, maxConsecutiveDays: 6 },
    };
    const output: ScheduleOutput = {
      assignments: [
        { shiftId: "mon-am", staffId: "s1" },
        { shiftId: "tue-am", staffId: "s1" },
      ],
    };
    const result = validateHardConstraints(input, output);
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("accumulates violations from multiple checks", () => {
    const output: ScheduleOutput = {
      assignments: [
        { shiftId: "mon-pm", staffId: "s2" }, // unavailable
        { shiftId: "mon-am", staffId: "s3" }, // unqualified (cashier for barista)
        // tue-am not covered
      ],
    };
    const result = validateHardConstraints(baseInput, output);
    expect(result.passed).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// isAvailableForShift
// ---------------------------------------------------------------------------

describe("isAvailableForShift", () => {
  const shift: Shift = {
    id: "mon-lunch", date: "2026-02-23", startTime: "11:00", endTime: "15:00",
    requiredRole: "barista", minStaff: 1,
  };

  it("returns true when availability window covers the shift", () => {
    const staff: Staff = {
      id: "s1", qualifications: ["barista"], maxWeeklyHours: 25, hourlyRate: 10,
      unavailable: [],
      availability: [{ day: "2026-02-23", startTime: "09:00", endTime: "17:00" }],
    };
    expect(isAvailableForShift(staff, shift, 3)).toBe(true);
  });

  it("returns true when overlap equals minShiftHours exactly", () => {
    const staff: Staff = {
      id: "s1", qualifications: ["barista"], maxWeeklyHours: 25, hourlyRate: 10,
      unavailable: [],
      availability: [{ day: "2026-02-23", startTime: "12:00", endTime: "15:00" }],
    };
    expect(isAvailableForShift(staff, shift, 3)).toBe(true);
  });

  it("returns false when overlap is less than minShiftHours", () => {
    const staff: Staff = {
      id: "s1", qualifications: ["barista"], maxWeeklyHours: 25, hourlyRate: 10,
      unavailable: [],
      availability: [{ day: "2026-02-23", startTime: "13:00", endTime: "15:00" }],
    };
    expect(isAvailableForShift(staff, shift, 3)).toBe(false);
  });

  it("returns false when no availability on shift date", () => {
    const staff: Staff = {
      id: "s1", qualifications: ["barista"], maxWeeklyHours: 25, hourlyRate: 10,
      unavailable: [],
      availability: [{ day: "2026-02-24", startTime: "09:00", endTime: "17:00" }],
    };
    expect(isAvailableForShift(staff, shift, 3)).toBe(false);
  });

  it("falls back to unavailable check when no availability field", () => {
    const available: Staff = {
      id: "s1", qualifications: ["barista"], maxWeeklyHours: 25, hourlyRate: 10,
      unavailable: ["mon-dinner"],
    };
    expect(isAvailableForShift(available, shift, 3)).toBe(true);

    const unavailable: Staff = {
      id: "s2", qualifications: ["barista"], maxWeeklyHours: 25, hourlyRate: 10,
      unavailable: ["mon-lunch"],
    };
    expect(isAvailableForShift(unavailable, shift, 3)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeAssignmentWindow
// ---------------------------------------------------------------------------

describe("computeAssignmentWindow", () => {
  const shift: Shift = {
    id: "mon-lunch", date: "2026-02-23", startTime: "11:00", endTime: "15:00",
    requiredRole: "barista", minStaff: 1,
  };

  it("returns intersection of availability and shift window", () => {
    const staff: Staff = {
      id: "s1", qualifications: ["barista"], maxWeeklyHours: 25, hourlyRate: 10,
      unavailable: [],
      availability: [{ day: "2026-02-23", startTime: "12:00", endTime: "17:00" }],
    };
    const result = computeAssignmentWindow(staff, shift, 3);
    expect(result).toEqual({ startTime: "12:00", endTime: "15:00" });
  });

  it("returns null when overlap is too short", () => {
    const staff: Staff = {
      id: "s1", qualifications: ["barista"], maxWeeklyHours: 25, hourlyRate: 10,
      unavailable: [],
      availability: [{ day: "2026-02-23", startTime: "14:00", endTime: "15:00" }],
    };
    expect(computeAssignmentWindow(staff, shift, 3)).toBeNull();
  });

  it("falls back to shift times when no availability field", () => {
    const staff: Staff = {
      id: "s1", qualifications: ["barista"], maxWeeklyHours: 25, hourlyRate: 10,
      unavailable: [],
    };
    const result = computeAssignmentWindow(staff, shift, 3);
    expect(result).toEqual({ startTime: "11:00", endTime: "15:00" });
  });

  it("returns null when staff is unavailable (no availability field)", () => {
    const staff: Staff = {
      id: "s1", qualifications: ["barista"], maxWeeklyHours: 25, hourlyRate: 10,
      unavailable: ["mon-lunch"],
    };
    expect(computeAssignmentWindow(staff, shift, 3)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// checkHourlyCoverage
// ---------------------------------------------------------------------------

describe("checkHourlyCoverage", () => {
  it("passes when all hours have enough staff", () => {
    const shifts: Shift[] = [
      { id: "s1", date: "2026-01-06", startTime: "11:00", endTime: "15:00", requiredRole: "barista", minStaff: 1 },
    ];
    const assignments = [
      { shiftId: "s1", staffId: "a1", startTime: "11:00", endTime: "15:00" },
    ];
    const result = checkHourlyCoverage(shifts, assignments);
    expect(result.passed).toBe(true);
    expect(result.gaps).toHaveLength(0);
  });

  it("detects understaffed hours when assignment only covers part of shift", () => {
    const shifts: Shift[] = [
      { id: "s1", date: "2026-01-06", startTime: "11:00", endTime: "15:00", requiredRole: "barista", minStaff: 1 },
    ];
    const assignments = [
      { shiftId: "s1", staffId: "a1", startTime: "11:00", endTime: "13:00" },
    ];
    const result = checkHourlyCoverage(shifts, assignments);
    expect(result.passed).toBe(false);
    expect(result.gaps.length).toBe(2); // hours 13 and 14 uncovered
  });

  it("counts multiple assignments at the same hour", () => {
    const shifts: Shift[] = [
      { id: "s1", date: "2026-01-06", startTime: "11:00", endTime: "13:00", requiredRole: "barista", minStaff: 2 },
    ];
    const assignments = [
      { shiftId: "s1", staffId: "a1", startTime: "11:00", endTime: "13:00" },
      { shiftId: "s1", staffId: "a2", startTime: "11:00", endTime: "13:00" },
    ];
    const result = checkHourlyCoverage(shifts, assignments);
    expect(result.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkAvailability with time-range availability
// ---------------------------------------------------------------------------

describe("checkAvailability with availability windows", () => {
  it("passes when assignment falls within availability window", () => {
    const input: ScheduleInput = {
      shifts: [
        { id: "mon-lunch", date: "2026-02-23", startTime: "11:00", endTime: "15:00", requiredRole: "barista", minStaff: 1 },
      ],
      staff: [{
        id: "s1", qualifications: ["barista"], maxWeeklyHours: 25, hourlyRate: 10,
        unavailable: [],
        availability: [{ day: "2026-02-23", startTime: "09:00", endTime: "17:00" }],
      }],
      constraints: { minRestHours: 10, maxConsecutiveDays: 6 },
    };
    const output: ScheduleOutput = {
      assignments: [{ shiftId: "mon-lunch", staffId: "s1" }],
    };
    const result = checkAvailability(input, output);
    expect(result.passed).toBe(true);
  });

  it("fails when assignment falls outside availability window", () => {
    const input: ScheduleInput = {
      shifts: [
        { id: "mon-dinner", date: "2026-02-23", startTime: "15:00", endTime: "21:00", requiredRole: "barista", minStaff: 1 },
      ],
      staff: [{
        id: "s1", qualifications: ["barista"], maxWeeklyHours: 25, hourlyRate: 10,
        unavailable: [],
        availability: [{ day: "2026-02-23", startTime: "09:00", endTime: "16:00" }],
      }],
      constraints: { minRestHours: 10, maxConsecutiveDays: 6 },
    };
    const output: ScheduleOutput = {
      assignments: [{ shiftId: "mon-dinner", staffId: "s1" }],
    };
    const result = checkAvailability(input, output);
    expect(result.passed).toBe(false);
  });

  it("passes with custom assignment times within availability", () => {
    const input: ScheduleInput = {
      shifts: [
        { id: "mon-dinner", date: "2026-02-23", startTime: "15:00", endTime: "21:00", requiredRole: "barista", minStaff: 1 },
      ],
      staff: [{
        id: "s1", qualifications: ["barista"], maxWeeklyHours: 25, hourlyRate: 10,
        unavailable: [],
        availability: [{ day: "2026-02-23", startTime: "09:00", endTime: "16:00" }],
      }],
      constraints: { minRestHours: 10, maxConsecutiveDays: 6 },
    };
    const output: ScheduleOutput = {
      assignments: [{ shiftId: "mon-dinner", staffId: "s1", startTime: "15:00", endTime: "16:00" }],
    };
    const result = checkAvailability(input, output);
    expect(result.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkShiftComposition — conditional rules
// ---------------------------------------------------------------------------

describe("checkShiftComposition", () => {
  const l2Rule = {
    shiftType: "barista",
    tag: "L2_or_above",
    minimumCount: 1,
    minProficiency: 0,
    required: false,
    condition: { whenTagPresent: "L1", whenMinCount: 1 },
  };

  const skills = [
    { staffId: "alice", tag: "L1", proficiency: 1 },
    { staffId: "bob", tag: "L2_or_above", proficiency: 4 },
    { staffId: "carol", tag: "L2_or_above", proficiency: 4 },
  ];

  it("skips rule when no L1 staff assigned (all-L2 shift)", () => {
    const assignments = [
      { shiftId: "s1", staffId: "bob", role: "barista", date: "2025-01-06", startTime: "09:00", endTime: "17:00" },
      { shiftId: "s1", staffId: "carol", role: "barista", date: "2025-01-06", startTime: "09:00", endTime: "17:00" },
    ];
    const violations = checkShiftComposition(assignments, skills, [l2Rule], "barista");
    expect(violations).toHaveLength(0);
  });

  it("passes when L1 is paired with L2", () => {
    const assignments = [
      { shiftId: "s1", staffId: "alice", role: "barista", date: "2025-01-06", startTime: "09:00", endTime: "17:00" },
      { shiftId: "s1", staffId: "bob", role: "barista", date: "2025-01-06", startTime: "09:00", endTime: "17:00" },
    ];
    const violations = checkShiftComposition(assignments, skills, [l2Rule], "barista");
    expect(violations).toHaveLength(0);
  });

  it("fails when L1 is assigned without L2", () => {
    const assignments = [
      { shiftId: "s1", staffId: "alice", role: "barista", date: "2025-01-06", startTime: "09:00", endTime: "17:00" },
    ];
    const violations = checkShiftComposition(assignments, skills, [l2Rule], "barista");
    expect(violations).toHaveLength(1);
    expect(violations[0].tag).toBe("L2_or_above");
    expect(violations[0].conditionTriggeredBy).toBe("L1");
    expect(violations[0].isHard).toBe(false);
  });

  it("unconditional rule still enforces without condition", () => {
    const unconditionalRule = {
      shiftType: "barista",
      tag: "L2_or_above",
      minimumCount: 1,
      minProficiency: 0,
      required: true,
    };
    const assignments = [
      { shiftId: "s1", staffId: "alice", role: "barista", date: "2025-01-06", startTime: "09:00", endTime: "17:00" },
    ];
    const violations = checkShiftComposition(assignments, skills, [unconditionalRule], "barista");
    expect(violations).toHaveLength(1);
    expect(violations[0].isHard).toBe(true);
    expect(violations[0].conditionTriggeredBy).toBeUndefined();
  });
});
