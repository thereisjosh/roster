/**
 * Reference-based scorer for promptfoo evals.
 *
 * Compares LLM schedule output against the manager's golden schedule
 * using shift-level weighted overlap. The golden schedule is the source
 * of truth — 100% = exact match.
 *
 * Scoring method:
 *   For each shift in golden schedule:
 *     golden_staff = set of staffIds assigned in reference
 *     llm_staff    = set of staffIds assigned in LLM output
 *     shift_score  = |intersection| / |golden_staff|  (recall per shift)
 *
 *   Overall = weighted average of shift_scores, weighted by golden_staff count.
 *
 * Also reports:
 *   - exactMatchRate    — % of shifts with identical staff sets
 *   - assignmentRecall  — total golden assignments recovered
 *   - assignmentPrecision — % of LLM assignments that exist in golden
 *   - staffUtilization  — % of staff who received at least 1 shift
 *
 * Pass threshold: overall >= 0.65
 */

import type { ScheduleOutput, Assignment } from "@/lib/scheduling/validator";
import { parseTimeToHours } from "@/lib/scheduling/validator";

interface ReferenceResult {
  pass: boolean;
  score: number;
  namedScores?: Record<string, number>;
  reason: string;
}

/**
 * Build a map of shiftId → Set<staffId> from assignments.
 */
function buildShiftStaffMap(assignments: ScheduleOutput["assignments"]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const a of assignments) {
    if (!map.has(a.shiftId)) {
      map.set(a.shiftId, new Set());
    }
    map.get(a.shiftId)!.add(a.staffId);
  }
  return map;
}

export default function referenceScorer(
  output: string,
  context: { vars: { reference?: string; input?: string } },
): ReferenceResult {
  try {
    const schedule: ScheduleOutput = JSON.parse(output);
    const referenceRaw = context.vars.reference;

    if (!referenceRaw) {
      return {
        pass: false,
        score: 0,
        reason: "No reference schedule provided in context.vars.reference",
      };
    }

    const reference: ScheduleOutput = JSON.parse(referenceRaw);

    if (!reference.assignments || reference.assignments.length === 0) {
      return {
        pass: false,
        score: 0,
        reason: "Reference schedule has no assignments",
      };
    }

    if (!schedule.assignments || schedule.assignments.length === 0) {
      return {
        pass: false,
        score: 0,
        reason: "LLM output has no assignments",
      };
    }

    const goldenMap = buildShiftStaffMap(reference.assignments);
    const llmMap = buildShiftStaffMap(schedule.assignments);

    // --- Shift-level weighted overlap ---
    let totalWeight = 0;
    let weightedScore = 0;
    let exactMatches = 0;
    let totalGoldenShifts = 0;

    for (const [shiftId, goldenStaff] of goldenMap) {
      totalGoldenShifts++;
      const weight = goldenStaff.size;
      totalWeight += weight;

      const llmStaff = llmMap.get(shiftId) ?? new Set<string>();

      // Recall per shift: how many golden staff did the LLM pick?
      let intersection = 0;
      for (const staffId of goldenStaff) {
        if (llmStaff.has(staffId)) intersection++;
      }

      const shiftScore = goldenStaff.size > 0 ? intersection / goldenStaff.size : 1;
      weightedScore += shiftScore * weight;

      // Exact match: identical staff sets
      if (
        goldenStaff.size === llmStaff.size &&
        intersection === goldenStaff.size
      ) {
        exactMatches++;
      }
    }

    const overall = totalWeight > 0 ? weightedScore / totalWeight : 0;
    const exactMatchRate = totalGoldenShifts > 0 ? exactMatches / totalGoldenShifts : 0;

    // --- Assignment-level recall & precision ---
    const goldenPairs = new Set(
      reference.assignments.map((a) => `${a.shiftId}::${a.staffId}`),
    );
    const llmPairs = new Set(
      schedule.assignments.map((a) => `${a.shiftId}::${a.staffId}`),
    );

    let recallHits = 0;
    for (const pair of goldenPairs) {
      if (llmPairs.has(pair)) recallHits++;
    }
    const assignmentRecall = goldenPairs.size > 0 ? recallHits / goldenPairs.size : 0;

    let precisionHits = 0;
    for (const pair of llmPairs) {
      if (goldenPairs.has(pair)) precisionHits++;
    }
    const assignmentPrecision = llmPairs.size > 0 ? precisionHits / llmPairs.size : 0;

    // --- Staff utilization ---
    let totalStaff = 0;
    if (context.vars.input) {
      try {
        const inputData = JSON.parse(context.vars.input);
        totalStaff = inputData.staff?.length ?? 0;
      } catch {
        // ignore parse errors on input
      }
    }

    const activeStaff = new Set(schedule.assignments.map((a) => a.staffId));
    const staffUtilization = totalStaff > 0 ? activeStaff.size / totalStaff : 0;

    // --- Time overlap scoring (30-min tolerance) ---
    const TOLERANCE_HOURS = 0.5; // 30 minutes
    let timeOverlapTotal = 0;
    let timeOverlapCount = 0;

    // Build maps of shiftId::staffId → assignment for time comparison
    const goldenAssignmentMap = new Map<string, Assignment>();
    for (const a of reference.assignments) {
      goldenAssignmentMap.set(`${a.shiftId}::${a.staffId}`, a);
    }

    for (const a of schedule.assignments) {
      const key = `${a.shiftId}::${a.staffId}`;
      const golden = goldenAssignmentMap.get(key);
      if (!golden) continue;

      // If either has custom times, compute overlap accuracy
      if (golden.startTime || golden.endTime || a.startTime || a.endTime) {
        timeOverlapCount++;
        const gStart = parseTimeToHours(golden.startTime ?? "00:00");
        const gEnd = parseTimeToHours(golden.endTime ?? "23:59");
        const lStart = parseTimeToHours(a.startTime ?? "00:00");
        const lEnd = parseTimeToHours(a.endTime ?? "23:59");

        const startDiff = Math.abs(gStart - lStart);
        const endDiff = Math.abs(gEnd - lEnd);

        // Score: 1.0 if within tolerance, degrade linearly beyond
        const startScore = startDiff <= TOLERANCE_HOURS ? 1.0 : Math.max(0, 1 - (startDiff - TOLERANCE_HOURS) / 2);
        const endScore = endDiff <= TOLERANCE_HOURS ? 1.0 : Math.max(0, 1 - (endDiff - TOLERANCE_HOURS) / 2);
        timeOverlapTotal += (startScore + endScore) / 2;
      }
    }

    const timeAccuracy = timeOverlapCount > 0 ? timeOverlapTotal / timeOverlapCount : 1.0;
    const pass = overall >= 0.65;

    return {
      pass,
      score: overall,
      namedScores: {
        referenceOverlap: overall,
        exactMatchRate,
        assignmentRecall,
        assignmentPrecision,
        staffUtilization,
        timeAccuracy,
      },
      reason: `Reference: ${overall.toFixed(3)} (exactMatch=${exactMatchRate.toFixed(2)}, recall=${assignmentRecall.toFixed(2)}, precision=${assignmentPrecision.toFixed(2)}, utilization=${staffUtilization.toFixed(2)}, timeAccuracy=${timeAccuracy.toFixed(2)}) | ${exactMatches}/${totalGoldenShifts} shifts exact | ${recallHits}/${goldenPairs.size} assignments recalled`,
    };
  } catch (e) {
    return {
      pass: false,
      score: 0,
      reason: `Failed to score against reference: ${e instanceof Error ? e.message : "unknown error"}`,
    };
  }
}
