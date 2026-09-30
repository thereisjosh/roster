/**
 * Scorer bridge — runs eval scorers against frontend-generated schedules.
 *
 * Maps ShiftAssignment[] (DB format) to the scorer's expected format and
 * invokes the deterministic schedule-scorer and slot-scorer.
 */

import { readFileSync } from "fs";
import { join } from "path";
import type { ShiftAssignment, GenerationSnapshot } from "@/lib/db/schema";
import type { ScheduleOutput, Assignment } from "./validator";
import { parseTimeToHours } from "./validator";
import scheduleScorer from "@/evals/scorers/schedule-scorer";
import slotScorer from "@/evals/scorers/slot-scorer";

export interface SlotMetrics {
  hoursCompliance: number;
  minStaffCoverage: number;
  eligibilityCompliance: number;
  staffUtilization: number;
  coverageCompleteness: number;
  slotRecall?: number;
  slotPrecision?: number;
  slotExactMatch?: number;
  referenceOverlap?: number;
}

export interface ScoringResult {
  pass: boolean;
  score: number;
  namedScores: { fairness: number; costOptimality: number; preference: number };
  tier1Violations: string[];
  reason: string;
  slotMetrics: SlotMetrics;
}

// ---------------------------------------------------------------------------
// Golden reference lookup
// ---------------------------------------------------------------------------

const WEEK_FILE_MAP: Record<string, string> = {
  "2026-02-23": "week-23feb",
  "2026-03-02": "week-2mar",
  "2026-03-09": "week-9mar",
  "2026-03-16": "week-16mar",
  "2026-03-23": "week-23mar",
  "2026-03-30": "week-30mar",
};

function loadGoldenReference(weekStart: string): string | undefined {
  const prefix = WEEK_FILE_MAP[weekStart];
  if (!prefix) return undefined;
  try {
    const filePath = join(process.cwd(), "evals/golden/schedules", `${prefix}-expected-slots.json`);
    return readFileSync(filePath, "utf-8");
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Slot format conversion
// ---------------------------------------------------------------------------

const DAY_ABBREVS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function getDayAbbrev(isoDate: string): string {
  const d = new Date(isoDate + "T00:00:00Z");
  return DAY_ABBREVS[d.getUTCDay()];
}

interface SlotEntry {
  slotId: string;
  staffId: string;
  date: string;
  hour: number;
  role: string;
}

export function toSlotFormat(
  assignments: ShiftAssignment[],
  useStaffId: boolean = false,
): { slots: SlotEntry[] } {
  const slots: SlotEntry[] = [];
  for (const a of assignments) {
    const startH = parseTimeToHours(a.startTime);
    const endH = parseTimeToHours(a.endTime);
    for (let h = Math.floor(startH); h < endH; h++) {
      slots.push({
        slotId: `${getDayAbbrev(a.day)}-${a.shiftType}-${h}`,
        staffId: useStaffId ? a.staffId : a.staffName.toLowerCase(),
        date: a.day,
        hour: h,
        role: a.shiftType,
      });
    }
  }
  return { slots };
}

/**
 * Run slot-scorer on assignments and return SlotMetrics.
 */
export function computeSlotMetrics(
  snapshot: GenerationSnapshot,
  assignments: ShiftAssignment[],
): SlotMetrics {
  const input = buildScorerInput(snapshot);

  // Pass 1: constraints (UUID staffIds, self-reference)
  const uuidSlots = toSlotFormat(assignments, true);
  const uuidOutput = JSON.stringify(uuidSlots);
  const constraintResult = slotScorer(uuidOutput, { vars: { reference: uuidOutput, input } });
  const cs = constraintResult.namedScores ?? {};

  // Pass 2: golden recall/precision (name staffIds, golden reference)
  const goldenRef = loadGoldenReference(snapshot.weekStart);
  let goldenMetrics: Partial<SlotMetrics> = {};
  if (goldenRef) {
    const nameSlots = toSlotFormat(assignments, false);
    const nameOutput = JSON.stringify(nameSlots);
    const goldenResult = slotScorer(nameOutput, { vars: { reference: goldenRef, input } });
    const gs = goldenResult.namedScores ?? {};
    goldenMetrics = {
      slotRecall: gs.slotRecall,
      slotPrecision: gs.slotPrecision,
      slotExactMatch: gs.slotExactMatch,
      referenceOverlap: gs.referenceOverlap,
    };
  }

  return {
    hoursCompliance: cs.hoursCompliance ?? 1.0,
    minStaffCoverage: cs.minStaffCoverage ?? 1.0,
    eligibilityCompliance: cs.eligibilityCompliance ?? 1.0,
    staffUtilization: cs.staffUtilization ?? 0,
    coverageCompleteness: cs.coverageCompleteness ?? 0,
    ...goldenMetrics,
  };
}

// ---------------------------------------------------------------------------
// Shift-level scorer helpers
// ---------------------------------------------------------------------------

/**
 * Convert ShiftAssignment[] (DB format) to Assignment[] (scorer format).
 * Reconstructs shiftId using the assembler convention: `${date}-${role}-${startTime}`
 */
function toScorerAssignments(assignments: ShiftAssignment[]): Assignment[] {
  return assignments.map((a) => ({
    shiftId: `${a.day}-${a.shiftType}-${a.startTime}`,
    staffId: a.staffId,
    date: a.day,
    startTime: a.startTime,
    endTime: a.endTime,
    role: a.shiftType,
  }));
}

/**
 * Build the scorer's context.vars.input object from the stored snapshot.
 * The schedule-scorer expects JSON.parse(context.vars.input) to yield
 * { staff, shifts, constraints, businessConfig, weekStart }.
 */
function buildScorerInput(snapshot: GenerationSnapshot): string {
  return JSON.stringify({
    staff: snapshot.input.staff,
    shifts: snapshot.input.shifts,
    constraints: snapshot.input.constraints,
    businessConfig: snapshot.config,
    weekStart: snapshot.weekStart,
  });
}

/**
 * Score a single variation against the generation snapshot.
 */
export function scoreVariation(
  snapshot: GenerationSnapshot,
  assignments: ShiftAssignment[],
): ScoringResult {
  const scorerAssignments = toScorerAssignments(assignments);

  const scheduleOutput: ScheduleOutput = {
    assignments: scorerAssignments,
  };

  const output = JSON.stringify(scheduleOutput);
  const input = buildScorerInput(snapshot);

  const result = scheduleScorer(output, { vars: { input } });

  // Extract tier1 violations from reason string
  const tier1Violations: string[] = [];
  if (!result.pass && result.score === 0 && result.reason.startsWith("Tier 1 violations:")) {
    tier1Violations.push(
      ...result.reason
        .replace("Tier 1 violations: ", "")
        .split("; "),
    );
  }

  const slotMetrics = computeSlotMetrics(snapshot, assignments);

  return {
    pass: result.pass as boolean,
    score: result.score as number,
    namedScores: (result as { namedScores?: ScoringResult["namedScores"] }).namedScores ?? {
      fairness: 0,
      costOptimality: 0,
      preference: 0,
    },
    tier1Violations,
    reason: result.reason as string,
    slotMetrics,
  };
}
