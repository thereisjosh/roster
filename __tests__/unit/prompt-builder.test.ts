import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  buildUserPrompt,
} from "@/lib/scheduling/prompt-builder";
import type { ScheduleInput } from "@/lib/scheduling/validator";
import type { BusinessConfig } from "@/lib/db/schema";

const sampleInput: ScheduleInput = {
  shifts: [
    { id: "2025-01-06-barista-07:00", date: "2025-01-06", startTime: "07:00", endTime: "15:00", requiredRole: "barista", minStaff: 1 },
  ],
  staff: [
    {
      id: "s1", qualifications: ["barista"], maxWeeklyHours: 44, hourlyRate: 12, unavailable: [],
      availability: [{ day: "2025-01-06", startTime: "07:00", endTime: "15:00" }],
      employmentType: "part-time",
    },
  ],
  constraints: { minRestHours: 10, maxConsecutiveDays: 6 },
};

const sampleConfig: BusinessConfig = {
  weekStartDay: 1,
  availabilityDeadlineDay: 4,
  availabilityDeadlineHour: 18,
  reminderIntervals: [24, 4],
  coverageRequirements: [
    { role: "barista", days: [1, 2, 3, 4, 5], startTime: "07:00", endTime: "15:00", minStaff: 1 },
  ],
  maxConsecutiveDays: 6,
  minRestHoursBetweenShifts: 10,
  costWeight: 0.25,
  fairnessWeight: 0.25,
  preferenceWeight: 0.35,
};

const defaultWeights = { costWeight: 0.25, fairnessWeight: 0.25, preferenceWeight: 0.35 };

describe("buildSystemPrompt", () => {
  it("contains eligibility guide and constraint tiers", () => {
    const prompt = buildSystemPrompt({
      input: sampleInput,
      variationType: "balanced",
      preferenceRules: [],
      config: sampleConfig,
    });
    expect(prompt).toContain("COVERAGE REQUIREMENTS");
    expect(prompt).toContain("CONSTRAINT TIERS");
    expect(prompt).toContain("CRITICAL (never violate)");
  });

  it("includes output format with hours array", () => {
    const prompt = buildSystemPrompt({
      input: sampleInput,
      variationType: "balanced",
      preferenceRules: [],
      config: sampleConfig,
    });
    expect(prompt).toContain("assignments");
    expect(prompt).toContain('"hours"');
    expect(prompt).toContain("JSON");
  });

  it("does NOT include variation guidance (now in user prompt)", () => {
    const prompt = buildSystemPrompt({
      input: sampleInput,
      variationType: "cost_optimised",
      preferenceRules: [],
      config: sampleConfig,
    });
    expect(prompt).not.toContain("MINIMIZE COST");
    expect(prompt).not.toContain("MAXIMIZE FAIRNESS");
  });
});

describe("buildUserPrompt", () => {
  it("includes JSON-only instruction and variation guidance", () => {
    const prompt = buildUserPrompt({
      input: sampleInput,
      variationType: "balanced",
      preferenceRules: [],
      weights: defaultWeights,
      config: sampleConfig,
    });
    expect(prompt).toContain("Generate the schedule now");
    expect(prompt).toContain("STAFFING PLAN");
  });

  it("includes retry violations when provided", () => {
    const prompt = buildUserPrompt({
      input: sampleInput,
      variationType: "balanced",
      preferenceRules: [],
      weights: defaultWeights,
      config: sampleConfig,
      retryViolations: ["Shift mon-am needs 2 staff, got 1", "s2 not qualified for barista"],
    });
    expect(prompt).toContain("previous attempt had the following hard constraint violations");
    expect(prompt).toContain("Shift mon-am needs 2 staff, got 1");
    expect(prompt).toContain("s2 not qualified for barista");
  });
});
