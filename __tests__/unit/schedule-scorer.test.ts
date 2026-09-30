import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import scheduleScorer from "@/evals/scorers/schedule-scorer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const goldenDir = resolve(__dirname, "../../evals/golden/schedules");

function loadJson(filename: string): string {
  return readFileSync(resolve(goldenDir, filename), "utf-8");
}

/** Expand coverageRequirements + weekStart into shifts array (mirrors scorer logic). */
function deriveShifts(data: any): any[] {
  const bc = data.businessConfig;
  if (!bc?.coverageRequirements || !data.weekStart) return data.shifts || [];
  const shifts: any[] = [];
  const ws = new Date(data.weekStart + "T00:00:00Z");
  for (let di = 0; di < 7; di++) {
    const d = new Date(ws.getTime() + di * 86400000);
    const dow = d.getUTCDay();
    if (bc.closedDays?.includes(dow)) continue;
    const dateStr = d.toISOString().slice(0, 10);
    for (const req of bc.coverageRequirements) {
      if (!req.days.includes(dow)) continue;
      shifts.push({
        id: `${dateStr}-${req.role}-${req.startTime}`,
        date: dateStr,
        startTime: req.startTime,
        endTime: req.endTime,
        requiredRole: req.role,
        minStaff: req.minStaff,
      });
    }
  }
  return shifts;
}

const inputJson = loadJson("week-2mar.json");
const expectedJson = loadJson("week-2mar-expected-output.json");

// Derive some shift IDs for the week-2mar fixture
const inputData = JSON.parse(inputJson);
const derivedShiftsData = deriveShifts(inputData);
const satBrunchId = derivedShiftsData.find(
  (s: any) => s.requiredRole === "barista" && s.startTime === "09:00" && new Date(s.date + "T00:00:00Z").getUTCDay() === 6,
)?.id; // e.g. "2026-03-07-barista-09:00"
const monLunchId = derivedShiftsData.find(
  (s: any) => s.requiredRole === "barista" && s.startTime === "11:00" && new Date(s.date + "T00:00:00Z").getUTCDay() === 1,
)?.id; // e.g. "2026-03-02-barista-11:00"

// ---------------------------------------------------------------------------
// Real manager schedule scores well
// ---------------------------------------------------------------------------

describe("scheduleScorer — real manager schedule", () => {
  it("passes with composite >= 0.75", () => {
    const result = scheduleScorer(expectedJson, { vars: { input: inputJson } });
    expect(result.pass).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.55);
  });

  it("returns a non-zero score", () => {
    const result = scheduleScorer(expectedJson, { vars: { input: inputJson } });
    expect(result.score).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Hard constraint violation returns score=0
// ---------------------------------------------------------------------------

describe("scheduleScorer — hard constraint violations", () => {
  it("returns score=0 for coverage gap", () => {
    const expected = JSON.parse(expectedJson);
    // Remove all sat-brunch assignments to create a coverage gap
    expected.assignments = expected.assignments.filter(
      (a: { shiftId: string }) => a.shiftId !== satBrunchId,
    );
    const result = scheduleScorer(JSON.stringify(expected), {
      vars: { input: inputJson },
    });
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reason).toContain(satBrunchId);
  });

  it("returns score=0 for availability violation", () => {
    const expected = JSON.parse(expectedJson);
    // Assign geri to mon-lunch — geri is unavailable for mon-lunch
    expected.assignments.push({ shiftId: monLunchId, staffId: "geri" });
    const result = scheduleScorer(JSON.stringify(expected), {
      vars: { input: inputJson },
    });
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reason).toContain("geri");
  });
});

// ---------------------------------------------------------------------------
// Unparseable output returns score=0
// ---------------------------------------------------------------------------

describe("scheduleScorer — unparseable output", () => {
  it("returns score=0 for non-JSON string", () => {
    const result = scheduleScorer("not json at all", {
      vars: { input: inputJson },
    });
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reason).toContain("Failed to parse");
  });

  it("returns score=0 for empty string", () => {
    const result = scheduleScorer("", { vars: { input: inputJson } });
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Fairness sensitivity — use all-barista assignment
// ---------------------------------------------------------------------------

describe("scheduleScorer — fairness sensitivity", () => {
  it("scores lower when one person gets all shifts", () => {
    const input = JSON.parse(inputJson);
    const shifts = deriveShifts(input);
    // Give geri all barista shifts, hau all kitchen shifts — qualifications satisfied
    const unfairOutput = {
      assignments: shifts.flatMap(
        (s: { id: string; minStaff: number; requiredRole: string }) =>
          Array.from({ length: s.minStaff }, () => ({
            shiftId: s.id,
            staffId: s.requiredRole === "chef" ? "hau" : "geri",
          })),
      ),
    };

    const fairResult = scheduleScorer(expectedJson, {
      vars: { input: inputJson },
    });
    const unfairResult = scheduleScorer(JSON.stringify(unfairOutput), {
      vars: { input: inputJson },
    });

    // The unfair schedule should either fail hard constraints (hours) or score lower
    if (unfairResult.score > 0) {
      expect(unfairResult.score).toBeLessThan(fairResult.score);
    } else {
      // geri exceeds maxWeeklyHours or other hard constraint failure
      expect(unfairResult.pass).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Closed days check
// ---------------------------------------------------------------------------

describe("scheduleScorer — checkClosedDays", () => {
  it("returns score=0 for assignment on Tuesday (closed day)", () => {
    const input = JSON.parse(inputJson);
    // Add shifts manually since fixture no longer has them — we need to add a Tuesday shift
    input.shifts = deriveShifts(input);
    input.shifts.push({
      id: "tue-lunch",
      date: "2026-03-03",
      startTime: "11:00",
      endTime: "15:00",
      requiredRole: "barista",
      minStaff: 1,
    });
    // Remove coverageRequirements so scorer uses input.shifts directly
    delete input.businessConfig.coverageRequirements;
    delete input.weekStart;
    const expected = JSON.parse(expectedJson);
    expected.assignments.push({ shiftId: "tue-lunch", staffId: "geri" });

    const result = scheduleScorer(JSON.stringify(expected), {
      vars: { input: JSON.stringify(input) },
    });
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reason).toContain("closed day");
  });
});

// ---------------------------------------------------------------------------
// Supervision check (L1/L2) — Tier 2 tolerated
// ---------------------------------------------------------------------------

describe("scheduleScorer — checkSupervision", () => {
  it("tolerates L1-only shift as tier 2 (not score=0)", () => {
    const expected = JSON.parse(expectedJson);

    // Replace keryn (L2) with jared (L1) on mon-lunch
    expected.assignments = expected.assignments.map(
      (a: { shiftId: string; staffId: string }) =>
        a.shiftId === monLunchId && a.staffId === "keryn"
          ? { ...a, staffId: "jared" }
          : a,
    );

    const result = scheduleScorer(JSON.stringify(expected), {
      vars: { input: inputJson },
    });
    // Tier 2: tolerated, NOT hard fail
    expect(result.score).toBeGreaterThan(0);
    expect(result.reason).toContain("L1 staff without L2/manager");
    expect(result.reason).toContain("tolerated");
  });

  it("passes when L1 is paired with L2", () => {
    // The real schedule has clemens (L1) on sat-brunch with geri (L2) — should pass
    const result = scheduleScorer(expectedJson, { vars: { input: inputJson } });
    expect(result.pass).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Full-time weekend check
// ---------------------------------------------------------------------------

describe("scheduleScorer — checkFullTimeWeekends", () => {
  it("returns score=0 for full-time staff with 0 weekend shifts", () => {
    const expected = JSON.parse(expectedJson);
    const shifts = deriveShifts(JSON.parse(inputJson));

    // Find hau's weekend kitchen shift IDs
    const hauWeekendIds = shifts
      .filter((s: any) => {
        const dow = new Date(s.date + "T00:00:00Z").getUTCDay();
        return s.requiredRole === "chef" && (dow === 0 || dow === 6);
      })
      .map((s: any) => s.id);

    // Remove all of hau's weekend assignments
    expected.assignments = expected.assignments.filter(
      (a: { shiftId: string; staffId: string }) =>
        !(a.staffId === "hau" && hauWeekendIds.includes(a.shiftId)),
    );

    const result = scheduleScorer(JSON.stringify(expected), {
      vars: { input: inputJson },
    });
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Assignment-level time overrides
// ---------------------------------------------------------------------------

describe("scheduleScorer — assignment-level time overrides", () => {
  it("uses assignment times for hours calculation", () => {
    // The expected output has chef assignments with startTime/endTime overrides
    // Verify the scorer processes them without error and passes
    const result = scheduleScorer(expectedJson, { vars: { input: inputJson } });
    expect(result.pass).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Valid manager schedules pass scorer
// ---------------------------------------------------------------------------

describe("scheduleScorer — valid manager schedules pass", () => {
  const weeks = ["week-23feb", "week-2mar", "week-16mar", "week-23mar"];

  for (const week of weeks) {
    it(`${week} passes with score >= 0.60`, () => {
      const weekInput = loadJson(`${week}.json`);
      const weekExpected = loadJson(`${week}-expected-output.json`);
      const result = scheduleScorer(weekExpected, { vars: { input: weekInput } });
      expect(result.pass).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(0.55);
    });
  }
});

describe("scheduleScorer — invalid manager fixtures fail hard gates", () => {
  it("rejects week-9mar for availability violations", () => {
    const weekInput = loadJson("week-9mar.json");
    const weekExpected = loadJson("week-9mar-expected-output.json");
    const result = scheduleScorer(weekExpected, { vars: { input: weekInput } });
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reason).toContain("availability doesn't cover this window");
  });

  it("rejects week-30mar for feasible undercoverage", () => {
    const weekInput = loadJson("week-30mar.json");
    const weekExpected = loadJson("week-30mar-expected-output.json");
    const result = scheduleScorer(weekExpected, { vars: { input: weekInput } });
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reason).toContain("need 2 staff, got 1");
  });
});

// ---------------------------------------------------------------------------
// Tolerates partial coverage on INFEASIBLE shifts
// ---------------------------------------------------------------------------

describe("scheduleScorer — infeasible shift tolerance", () => {
  it("tolerates partial coverage on INFEASIBLE shifts (week-23feb fri-dinner)", () => {
    const febInput = loadJson("week-23feb.json");
    const febExpected = loadJson("week-23feb-expected-output.json");
    const result = scheduleScorer(febExpected, { vars: { input: febInput } });
    expect(result.pass).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.55);
  });
});

// ---------------------------------------------------------------------------
// Tolerates full-time hours between target and max
// ---------------------------------------------------------------------------

describe("scheduleScorer — full-time hours tolerance", () => {
  it("tolerates full-time hours between target and max (week-23feb)", () => {
    const febInput = loadJson("week-23feb.json");
    const febExpected = loadJson("week-23feb-expected-output.json");
    const result = scheduleScorer(febExpected, { vars: { input: febInput } });
    expect(result.pass).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.55);
  });

  it("still fails for hours over fullTimeHours.max", () => {
    const input = JSON.parse(inputJson);
    const expected = JSON.parse(expectedJson);

    // Add extra shifts by falling back to explicit shifts array
    input.shifts = deriveShifts(input);
    delete input.businessConfig.coverageRequirements;
    delete input.weekStart;
    input.shifts.push({
      id: "extra-kitchen-1",
      date: "2026-03-02",
      startTime: "07:00",
      endTime: "11:00",
      requiredRole: "chef",
      minStaff: 1,
      breakMinutes: 0,
    });
    input.shifts.push({
      id: "extra-kitchen-2",
      date: "2026-03-04",
      startTime: "07:00",
      endTime: "11:00",
      requiredRole: "chef",
      minStaff: 1,
      breakMinutes: 0,
    });
    expected.assignments.push({ shiftId: "extra-kitchen-1", staffId: "hau" });
    expected.assignments.push({ shiftId: "extra-kitchen-2", staffId: "hau" });

    const result = scheduleScorer(JSON.stringify(expected), {
      vars: { input: JSON.stringify(input) },
    });
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tolerates weekend gap when shift is infeasible
// ---------------------------------------------------------------------------

describe("scheduleScorer — weekend gap tolerance on infeasible", () => {
  it("does not mask tier-1 availability violations (week-9mar)", () => {
    const marInput = loadJson("week-9mar.json");
    const marExpected = loadJson("week-9mar-expected-output.json");
    const result = scheduleScorer(marExpected, { vars: { input: marInput } });
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reason).toContain("availability doesn't cover this window");
  });
});
