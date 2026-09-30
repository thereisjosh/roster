import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import referenceScorer from "@/evals/scorers/reference-scorer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const goldenDir = resolve(__dirname, "../../evals/golden/schedules");

function loadJson(filename: string): string {
  return readFileSync(resolve(goldenDir, filename), "utf-8");
}

const inputJson = loadJson("week-2mar.json");
const expectedJson = loadJson("week-2mar-expected-output.json");

// ---------------------------------------------------------------------------
// Exact match — golden vs itself → 1.0
// ---------------------------------------------------------------------------

describe("referenceScorer — exact match", () => {
  it("scores 1.0 when output matches reference exactly", () => {
    const result = referenceScorer(expectedJson, {
      vars: { reference: expectedJson, input: inputJson },
    });
    expect(result.pass).toBe(true);
    expect(result.score).toBe(1.0);
    expect(result.namedScores?.exactMatchRate).toBe(1.0);
    expect(result.namedScores?.assignmentRecall).toBe(1.0);
    expect(result.namedScores?.assignmentPrecision).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// All 6 golden schedules score 1.0 against themselves
// ---------------------------------------------------------------------------

describe("referenceScorer — all golden schedules self-match", () => {
  const weeks = [
    "week-23feb",
    "week-2mar",
    "week-9mar",
    "week-16mar",
    "week-23mar",
    "week-30mar",
  ];

  for (const week of weeks) {
    it(`${week} scores 1.0 against itself`, () => {
      const weekInput = loadJson(`${week}.json`);
      const weekExpected = loadJson(`${week}-expected-output.json`);
      const result = referenceScorer(weekExpected, {
        vars: { reference: weekExpected, input: weekInput },
      });
      expect(result.pass).toBe(true);
      expect(result.score).toBe(1.0);
    });
  }
});

// ---------------------------------------------------------------------------
// Remove half the assignments → score ~0.50
// ---------------------------------------------------------------------------

describe("referenceScorer — partial match", () => {
  it("scores ~0.50 when half the assignments are removed", () => {
    const expected = JSON.parse(expectedJson);
    const halfOutput = {
      assignments: expected.assignments.filter(
        (_: unknown, i: number) => i % 2 === 0,
      ),
    };
    const result = referenceScorer(JSON.stringify(halfOutput), {
      vars: { reference: expectedJson, input: inputJson },
    });
    expect(result.pass).toBe(false);
    expect(result.score).toBeGreaterThan(0.2);
    expect(result.score).toBeLessThan(0.85);
    expect(result.namedScores?.assignmentRecall).toBeLessThan(0.7);
  });
});

// ---------------------------------------------------------------------------
// Add wrong staff → precision drops
// ---------------------------------------------------------------------------

describe("referenceScorer — wrong staff lowers precision", () => {
  it("has lower precision when non-golden staff are added", () => {
    const expected = JSON.parse(expectedJson);
    // Add fake assignments that don't exist in golden
    const extraAssignments = [
      { shiftId: "mon-lunch", staffId: "fake-person-1" },
      { shiftId: "wed-lunch", staffId: "fake-person-2" },
      { shiftId: "thu-lunch", staffId: "fake-person-3" },
      { shiftId: "fri-lunch", staffId: "fake-person-4" },
    ];
    const inflatedOutput = {
      assignments: [...expected.assignments, ...extraAssignments],
    };
    const result = referenceScorer(JSON.stringify(inflatedOutput), {
      vars: { reference: expectedJson, input: inputJson },
    });
    // Recall should still be 1.0 (all golden assignments present)
    expect(result.namedScores?.assignmentRecall).toBe(1.0);
    // Precision should drop (extra non-golden assignments)
    expect(result.namedScores?.assignmentPrecision).toBeLessThan(1.0);
    // Overall (recall-based) should still be 1.0
    expect(result.score).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// Empty output → score 0
// ---------------------------------------------------------------------------

describe("referenceScorer — empty output", () => {
  it("scores 0 for empty assignments array", () => {
    const result = referenceScorer(JSON.stringify({ assignments: [] }), {
      vars: { reference: expectedJson, input: inputJson },
    });
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
  });

  it("scores 0 for non-JSON output", () => {
    const result = referenceScorer("not json", {
      vars: { reference: expectedJson, input: inputJson },
    });
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reason).toContain("Failed to score");
  });
});

// ---------------------------------------------------------------------------
// Missing reference → score 0
// ---------------------------------------------------------------------------

describe("referenceScorer — missing reference", () => {
  it("scores 0 when no reference is provided", () => {
    const result = referenceScorer(expectedJson, { vars: {} });
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reason).toContain("No reference");
  });
});
