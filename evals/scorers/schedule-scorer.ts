/**
 * Composite schedule quality scorer for promptfoo evals.
 *
 * Tiered constraint classification (derived from manager behavior):
 *
 * Tier 1 (absolute, score=0):
 * - Qualifications, Availability, Rest periods, Consecutive days, Closed days
 * - Coverage on FEASIBLE shifts where unstaffed slots could have been filled
 * - Hours for part-time staff OR hours > fullTimeHours.max
 *
 * Tier 2 (tolerated, logged but no penalty):
 * - Coverage on INFEASIBLE shifts where all eligible staff ARE assigned
 * - Coverage on feasible shifts where all unassigned eligible staff are blocked
 *   by hours or rest constraints (dynamically infeasible)
 * - Full-time hours between target (maxWeeklyHours) and fullTimeHours.max
 * - Weekend violations where the missing shift is infeasible
 * - Supervision violations (L1 without L2 — manager tolerates as judgment call)
 *
 * Soft constraints (0.0-1.0 score):
 * - Fairness distribution — Gini coefficient
 * - Cost optimality
 * - Preference adherence — availability-based
 *
 * Weights are sourced from businessConfig.weights and normalized to sum to 1.0.
 *
 * Composite: weighted sum of soft scores, gated by zero tier-1 violations.
 * Minimum composite score for eval pass: 0.55
 */

import {
  type ScheduleInput,
  type ScheduleOutput,
  type Assignment,
  type Shift,
  type Staff,
  checkQualifications,
  checkHoursCompliance,
  checkAvailability,
  checkRestPeriods,
  checkConsecutiveDays,
  checkHourlyCoverage,
  isAvailableForShift,
  parseTimeToHours,
  shiftWorkedHours,
  assignmentWorkedHours,
  calculateGini,
} from "@/lib/scheduling/validator";

// --- Types for businessConfig fields used by the scorer ---

interface BusinessConfig {
  minRestHoursBetweenShifts: number;
  maxConsecutiveDays: number;
  closedDays: number[]; // 0=Sunday, 1=Monday, ... 6=Saturday
  fullTimeHours?: { min: number; target: number; max: number };
  breakRules?: { durationMinutes: number }[];
  breakDeduction?: { enabled: boolean; appliesTo: "full-time" | "part-time" | "both" };
  weights: { cost: number; fairness: number; preference: number };
  minShiftHours?: number; // default 3
  coverageRequirements?: {
    role: string;
    days: number[];
    startTime: string;
    endTime: string;
    minStaff: number;
  }[];
}

function expandCoverageToShifts(bc: BusinessConfig, weekStart: string): Shift[] {
  const shifts: Shift[] = [];
  const ws = new Date(weekStart + "T00:00:00Z");
  for (let di = 0; di < 7; di++) {
    const d = new Date(ws.getTime() + di * 86400000);
    const dayOfWeek = d.getUTCDay();
    if (bc.closedDays && bc.closedDays.includes(dayOfWeek)) continue;
    const dateStr = d.toISOString().slice(0, 10);
    for (const req of bc.coverageRequirements!) {
      if (!req.days.includes(dayOfWeek)) continue;
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

// --- Feasibility Helpers ---

/**
 * For each shift, compute how many staff are eligible (qualified + available).
 * A shift is FEASIBLE if eligible >= minStaff, INFEASIBLE otherwise.
 */
function computeShiftFeasibility(
  shifts: Shift[],
  staff: Staff[],
  minShiftHours: number = 3,
): Map<string, { eligible: string[]; isFeasible: boolean }> {
  const result = new Map<string, { eligible: string[]; isFeasible: boolean }>();
  for (const shift of shifts) {
    const eligible = staff
      .filter((s) => s.qualifications.includes(shift.requiredRole))
      .filter((s) => {
        // Staff with explicit empty availability have no available windows this week
        if (s.availability && s.availability.length === 0) return false;
        return isAvailableForShift(s, shift, minShiftHours);
      })
      .map((s) => s.id);
    result.set(shift.id, {
      eligible,
      isFeasible: eligible.length >= shift.minStaff,
    });
  }
  return result;
}

/**
 * Check if a staff member is blocked from working a target shift due to
 * hours budget exhaustion or rest period conflicts with current assignments.
 */
function isStaffBlockedForShift(
  staffId: string,
  targetShift: Shift,
  schedule: ScheduleOutput,
  shiftMap: Map<string, Shift>,
  staffMap: Map<string, Staff>,
  minRestHours: number,
  effectiveMaxHours: number,
  breakPerDay: number = 0,
  bc?: BusinessConfig,
): boolean {
  const staff = staffMap.get(staffId);
  if (!staff) return true;

  // Check hours budget using net hours (gross - break deductions per day worked)
  const dailyHours: Record<string, number> = {};
  for (const a of schedule.assignments) {
    if (a.staffId !== staffId) continue;
    const s = shiftMap.get(a.shiftId);
    if (!s) continue;
    dailyHours[s.date] = (dailyHours[s.date] ?? 0) + assignmentWorkedHours(a, s);
  }
  const addedHours = shiftWorkedHours(targetShift);
  const targetDate = targetShift.date;
  const projectedDaily = { ...dailyHours };
  projectedDaily[targetDate] = (projectedDaily[targetDate] ?? 0) + addedHours;
  let totalGross = 0;
  const daysCount = Object.keys(projectedDaily).length;
  for (const h of Object.values(projectedDaily)) {
    totalGross += h;
  }
  const deduct = bc ? shouldDeductBreaks(bc, staff) : breakPerDay > 0;
  const netHours = deduct ? totalGross - breakPerDay * daysCount : totalGross;
  if (netHours > effectiveMaxHours) return true;

  // Check rest period conflicts
  const targetStartH = parseTimeToHours(targetShift.startTime);
  const targetEndH = parseTimeToHours(targetShift.endTime);
  const targetStartMs = new Date(`${targetShift.date}T${targetShift.startTime}`).getTime();
  const targetEndMs = new Date(`${targetShift.date}T${targetShift.endTime}`).getTime();

  for (const a of schedule.assignments) {
    if (a.staffId !== staffId) continue;
    const s = shiftMap.get(a.shiftId);
    if (!s) continue;
    const aEnd = a.endTime ?? s.endTime;
    const aStart = a.startTime ?? s.startTime;
    const aEndMs = new Date(`${s.date}T${aEnd}`).getTime();
    const aStartMs = new Date(`${s.date}T${aStart}`).getTime();

    // Same-day: check for temporal overlap (can't work two shifts at the same time)
    if (s.date === targetShift.date) {
      if (aStartMs < targetEndMs && aEndMs > targetStartMs) return true;
      continue;
    }

    // Rest before target shift (existing ends, then target starts)
    const restBeforeH = (targetStartMs - aEndMs) / (1000 * 60 * 60);
    if (restBeforeH >= 0 && restBeforeH < minRestHours) return true;

    // Rest after target shift (target ends, then existing starts)
    const restAfterH = (aStartMs - targetEndMs) / (1000 * 60 * 60);
    if (restAfterH >= 0 && restAfterH < minRestHours) return true;
  }

  return false;
}

// --- Soft Constraints ---

/** Compute total break minutes per day from breakRules config, converted to hours. */
function breakDeductHoursPerDay(bc: BusinessConfig): number {
  if (!bc.breakRules) return 0;
  return bc.breakRules.reduce((sum, b) => sum + b.durationMinutes, 0) / 60;
}

/** Returns true if break deduction should apply to this staff member. */
function shouldDeductBreaks(bc: BusinessConfig, staff: Staff): boolean {
  if (!bc.breakDeduction?.enabled) return false;
  const appliesTo = bc.breakDeduction.appliesTo;
  if (appliesTo === "both") return true;
  if (appliesTo === "full-time") return staff.employmentType === "full-time";
  if (appliesTo === "part-time") return staff.employmentType === "part-time";
  return false;
}

/** Count distinct days worked per staff (for break deduction calculation). */
function daysWorkedPerStaff(
  assignments: Assignment[],
  shiftMap: Map<string, Shift>,
): Record<string, number> {
  const daysByStaff: Record<string, Set<string>> = {};
  for (const a of assignments) {
    const shift = shiftMap.get(a.shiftId);
    if (!shift) continue;
    if (!daysByStaff[a.staffId]) daysByStaff[a.staffId] = new Set();
    daysByStaff[a.staffId].add(shift.date);
  }
  const result: Record<string, number> = {};
  for (const [id, days] of Object.entries(daysByStaff)) {
    result[id] = days.size;
  }
  return result;
}

function scoreFairness(input: ScheduleInput, output: ScheduleOutput, bc: BusinessConfig): number {
  const shiftMap = new Map(input.shifts.map((s) => [s.id, s]));
  const staffMap = new Map(input.staff.map((s) => [s.id, s]));
  const hoursPerStaff: number[] = [];
  const breakPerDay = breakDeductHoursPerDay(bc);
  const daysWorkedMap = daysWorkedPerStaff(output.assignments, shiftMap);

  const byStaff: Record<string, number> = {};
  for (const assignment of output.assignments) {
    const shift = shiftMap.get(assignment.shiftId);
    if (!shift) continue;
    const hours = assignmentWorkedHours(assignment, shift);
    byStaff[assignment.staffId] = (byStaff[assignment.staffId] ?? 0) + hours;
  }

  for (const staff of input.staff) {
    const gross = byStaff[staff.id] ?? 0;
    const deduction = shouldDeductBreaks(bc, staff) ? breakPerDay * (daysWorkedMap[staff.id] ?? 0) : 0;
    hoursPerStaff.push(Math.max(0, gross - deduction));
  }

  const gini = calculateGini(hoursPerStaff);
  return Math.max(0, 1 - gini);
}

function scoreCostOptimality(input: ScheduleInput, output: ScheduleOutput): number {
  const shiftMap = new Map(input.shifts.map((s) => [s.id, s]));
  const staffMap = new Map(input.staff.map((s) => [s.id, s]));

  let actualCost = 0;
  for (const assignment of output.assignments) {
    const shift = shiftMap.get(assignment.shiftId);
    const staff = staffMap.get(assignment.staffId);
    if (!shift || !staff) continue;
    const hours = assignmentWorkedHours(assignment, shift);
    actualCost += hours * staff.hourlyRate;
  }

  let minCost = 0;
  for (const shift of input.shifts) {
    const qualified = input.staff
      .filter((s) => s.qualifications.includes(shift.requiredRole))
      .sort((a, b) => a.hourlyRate - b.hourlyRate);
    const hours = shiftWorkedHours(shift);
    for (let i = 0; i < shift.minStaff && i < qualified.length; i++) {
      minCost += hours * qualified[i].hourlyRate;
    }
  }

  if (minCost === 0) return 1.0;
  return Math.min(1.0, minCost / actualCost);
}

function scorePreference(input: ScheduleInput, output: ScheduleOutput): number {
  const staffMap = new Map(input.staff.map((s) => [s.id, s]));
  const shiftMap = new Map(input.shifts.map((s) => [s.id, s]));

  let totalHours = 0;
  let availableHours = 0;

  for (const assignment of output.assignments) {
    const shift = shiftMap.get(assignment.shiftId);
    const staff = staffMap.get(assignment.staffId);
    if (!shift || !staff) continue;

    const hours = assignmentWorkedHours(assignment, shift);
    totalHours += hours;

    if (isAvailableForShift(staff, shift)) {
      availableHours += hours;
    }
  }

  return totalHours === 0 ? 1.0 : availableHours / totalHours;
}

// --- BusinessConfig-based constraint checks ---

function checkClosedDays(
  shifts: ScheduleInput["shifts"],
  output: ScheduleOutput,
  closedDays: number[],
): string[] {
  if (closedDays.length === 0) return [];

  const violations: string[] = [];
  const shiftMap = new Map(shifts.map((s) => [s.id, s]));

  for (const assignment of output.assignments) {
    const shift = shiftMap.get(assignment.shiftId);
    if (!shift) continue;
    const dow = new Date(shift.date).getUTCDay();
    if (closedDays.includes(dow)) {
      violations.push(
        `Assignment on closed day: ${assignment.staffId} assigned to ${assignment.shiftId} (${shift.date}, day-of-week ${dow})`,
      );
    }
  }
  return violations;
}

function checkSupervision(
  shifts: ScheduleInput["shifts"],
  output: ScheduleOutput,
  staff: Staff[],
): string[] {
  const staffMap = new Map(staff.map((s) => [s.id, s]));
  const shiftMap = new Map(shifts.map((s) => [s.id, s]));
  const violations: string[] = [];

  const byShift: Record<string, string[]> = {};
  for (const assignment of output.assignments) {
    if (!shiftMap.has(assignment.shiftId)) continue;
    if (!byShift[assignment.shiftId]) byShift[assignment.shiftId] = [];
    byShift[assignment.shiftId].push(assignment.staffId);
  }

  for (const [shiftId, staffIds] of Object.entries(byShift)) {
    const levels = staffIds.map((id) => staffMap.get(id)?.level);
    const hasL1 = levels.some((l) => l === "L1");
    const hasSupervisor = levels.some((l) => l === "L2" || l === "manager");
    if (hasL1 && !hasSupervisor) {
      const shift = shiftMap.get(shiftId);
      if (!shift) continue;
      const l2Available = staff.some(
        (s) =>
          (s.level === "L2" || s.level === "manager") &&
          s.qualifications.includes(shift.requiredRole) &&
          isAvailableForShift(s, shift),
      );
      if (l2Available) {
        violations.push(`Shift ${shiftId}: L1 staff without L2/manager supervision (${staffIds.join(", ")})`);
      }
    }
  }
  return violations;
}

function checkFullTimeWeekends(
  shifts: ScheduleInput["shifts"],
  output: ScheduleOutput,
  staff: Staff[],
  feasibility: Map<string, { eligible: string[]; isFeasible: boolean }>,
  shiftMap: Map<string, Shift>,
  staffMap: Map<string, Staff>,
  minRestHours: number,
  ftMax: number,
  breakPerDay: number = 0,
  bc?: BusinessConfig,
): string[] {
  const violations: string[] = [];

  const fullTimeStaff = staff.filter((s) => s.employmentType === "full-time");
  if (fullTimeStaff.length === 0) return [];

  const weekendShiftIds = shifts
    .filter((s) => {
      const dow = new Date(s.date).getUTCDay();
      return dow === 0 || dow === 6;
    })
    .map((s) => s.id);

  for (const ft of fullTimeStaff) {
    const availableWeekendShifts = weekendShiftIds.filter(
      (sid) => {
        const shift = shiftMap.get(sid);
        return shift &&
          ft.qualifications.includes(shift.requiredRole) &&
          isAvailableForShift(ft, shift);
      },
    );
    if (availableWeekendShifts.length < 2) continue;

    const weekendAssignments = output.assignments.filter((a) => {
      if (a.staffId !== ft.id) return false;
      const shift = shiftMap.get(a.shiftId);
      if (!shift) return false;
      const dow = new Date(shift.date).getUTCDay();
      return dow === 0 || dow === 6;
    });
    if (weekendAssignments.length < 2) {
      // Check if missed weekend shifts are all infeasible or dynamically blocked
      const missedWeekendShifts = availableWeekendShifts.filter(
        (sid) => !weekendAssignments.some((a) => a.shiftId === sid),
      );
      const allMissedAreBlocked = missedWeekendShifts.length > 0 &&
        missedWeekendShifts.every((sid) => {
          const f = feasibility.get(sid);
          if (f && !f.isFeasible) return true; // statically infeasible
          // Check dynamic blocking (hours/rest)
          const shift = shiftMap.get(sid);
          if (!shift) return false;
          return isStaffBlockedForShift(ft.id, shift, output, shiftMap, staffMap, minRestHours, ftMax, breakPerDay, bc);
        });

      if (!allMissedAreBlocked) {
        violations.push(
          `${ft.id}: full-time staff has ${weekendAssignments.length} weekend shift(s), minimum is 2`,
        );
      }
    }
  }
  return violations;
}

// --- Main Scorer (Promptfoo entry point) ---

export default function scheduleScorer(output: string, context: { vars: { input: string } }) {
  try {
    const schedule: ScheduleOutput = JSON.parse(output);
    const fullInput = JSON.parse(context.vars.input);
    const bc: BusinessConfig = fullInput.businessConfig;

    const derivedShifts = (bc.coverageRequirements && fullInput.weekStart)
      ? expandCoverageToShifts(bc, fullInput.weekStart)
      : fullInput.shifts;

    const input: ScheduleInput = {
      shifts: derivedShifts,
      staff: fullInput.staff,
      constraints: {
        minRestHours: bc.minRestHoursBetweenShifts,
        maxConsecutiveDays: bc.maxConsecutiveDays,
      },
    };

    const minShiftHours = bc.minShiftHours ?? 3;
    const feasibility = computeShiftFeasibility(input.shifts, fullInput.staff, minShiftHours);
    const staffMap = new Map<string, Staff>(fullInput.staff.map((s: Staff) => [s.id, s]));
    const shiftMap = new Map<string, Shift>(input.shifts.map((s: Shift) => [s.id, s]));
    const ftMax = bc.fullTimeHours?.max ?? Infinity;
    const breakPerDayMain = breakDeductHoursPerDay(bc);

    // ---------------------------------------------------------------
    // Tier 1: Absolute hard constraints (any violation → score=0)
    // ---------------------------------------------------------------
    const tier1: string[] = [];

    const qualViolations = checkQualifications(input, schedule);
    tier1.push(...qualViolations.violations);

    const availViolations = checkAvailability(input, schedule);
    tier1.push(...availViolations.violations);

    const restViolations = checkRestPeriods(input, schedule);
    tier1.push(...restViolations.violations);

    const consViolations = checkConsecutiveDays(input, schedule);
    tier1.push(...consViolations.violations);

    const closedDayViolations = checkClosedDays(input.shifts, schedule, bc.closedDays);
    tier1.push(...closedDayViolations);

    // Coverage: classify by feasibility (static + dynamic) — hourly overlap-based
    const coverageResult = checkHourlyCoverage(
      input.shifts,
      schedule.assignments,
      shiftMap,
      { coverageRequirements: bc.coverageRequirements, closedDays: bc.closedDays },
      fullInput.staff,
    );
    const tier2Coverage: string[] = [];

    for (const v of coverageResult.violations) {
      const match = v.match(/^Shift (\S+)/);
      const shiftId = match?.[1];
      const f = shiftId ? feasibility.get(shiftId) : undefined;
      const shift = shiftId ? shiftMap.get(shiftId) : undefined;

      if (!f || !shift) {
        tier1.push(v);
        continue;
      }

      const assignedToShift = schedule.assignments
        .filter((a) => a.shiftId === shiftId)
        .map((a) => a.staffId);
      const unassignedEligible = f.eligible.filter((id) => !assignedToShift.includes(id));

      if (!f.isFeasible) {
        // Statically infeasible — tolerate if all eligible are assigned
        const allEligibleAssigned = f.eligible.every((id) => assignedToShift.includes(id));
        if (allEligibleAssigned) {
          tier2Coverage.push(v + " [INFEASIBLE, all eligible assigned — tolerated]");
        } else {
          tier1.push(v);
        }
      } else if (unassignedEligible.length > 0) {
        // Statically feasible — check if unassigned eligible are dynamically blocked
        const allBlocked = unassignedEligible.every((id) => {
          const s = staffMap.get(id);
          const maxH = s?.maxWeeklyHours ?? ftMax;
          return isStaffBlockedForShift(id, shift, schedule, shiftMap, staffMap, bc.minRestHoursBetweenShifts, maxH, breakPerDayMain, bc);
        });
        if (allBlocked) {
          tier2Coverage.push(v + " [all eligible staff blocked by hours/rest — tolerated]");
        } else {
          tier1.push(v);
        }
      } else {
        // No unassigned eligible and still under minStaff — infeasible
        tier2Coverage.push(v + " [all eligible assigned — tolerated]");
      }
    }

    // Hours: tier 1 for part-time or over fullTimeHours.max
    // Compute net hours (gross - break deductions per day worked)
    const hoursResult = checkHoursCompliance(input, schedule, {
      breakRules: bc.breakRules,
      breakDeduction: bc.breakDeduction,
    });
    const tier2Hours: string[] = [];
    const breakPerDay = breakDeductHoursPerDay(bc);
    const daysWorkedMap = daysWorkedPerStaff(schedule.assignments, shiftMap);

    const actualHoursPerStaff: Record<string, number> = {};
    for (const assignment of schedule.assignments) {
      const shift = shiftMap.get(assignment.shiftId);
      if (!shift) continue;
      const hours = assignmentWorkedHours(assignment, shift);
      actualHoursPerStaff[assignment.staffId] = (actualHoursPerStaff[assignment.staffId] ?? 0) + hours;
    }
    // Apply per-day break deductions to get net hours (only for eligible staff)
    for (const staffId of Object.keys(actualHoursPerStaff)) {
      const s = staffMap.get(staffId);
      if (s && shouldDeductBreaks(bc, s)) {
        actualHoursPerStaff[staffId] = Math.max(0,
          actualHoursPerStaff[staffId] - breakPerDay * (daysWorkedMap[staffId] ?? 0));
      }
    }

    for (const v of hoursResult.violations) {
      const match = v.match(/^(\S+) assigned/);
      const staffId = match?.[1];
      const staff = staffId ? staffMap.get(staffId) : undefined;
      const netHours = staffId ? (actualHoursPerStaff[staffId] ?? 0) : 0;

      if (staff && staff.employmentType === "full-time" && netHours <= ftMax) {
        tier2Hours.push(v + ` [full-time ${netHours.toFixed(1)}h net <= ${ftMax}h max — tolerated]`);
      } else if (staff && staff.employmentType === "part-time") {
        // Check net hours against part-time max
        const ptMax = staff.maxWeeklyHours ?? Infinity;
        if (netHours <= ptMax) {
          tier2Hours.push(v + ` [part-time ${netHours.toFixed(1)}h net <= ${ptMax}h max — tolerated]`);
        } else {
          tier1.push(v);
        }
      } else {
        tier1.push(v);
      }
    }

    if (tier1.length > 0) {
      return {
        pass: false,
        score: 0,
        reason: `Tier 1 violations: ${tier1.join("; ")}`,
      };
    }

    // ---------------------------------------------------------------
    // Tier 2: Tolerated (logged, no penalty)
    // ---------------------------------------------------------------
    const tier2: string[] = [...tier2Coverage, ...tier2Hours];

    // Weekend violations with feasibility + dynamic blocking awareness
    const weekendViolations = checkFullTimeWeekends(
      input.shifts, schedule, fullInput.staff, feasibility,
      shiftMap, staffMap, bc.minRestHoursBetweenShifts, ftMax, breakPerDayMain, bc,
    );
    if (weekendViolations.length > 0) {
      tier2.push(...weekendViolations.map((v) => v + " [weekend preference — tolerated]"));
    }

    // Supervision — tier 2 (manager tolerates L1 unsupervised as judgment call)
    const supervisionViolations = checkSupervision(input.shifts, schedule, fullInput.staff);
    tier2.push(...supervisionViolations.map((v) => v + " [supervision — tolerated]"));

    // ---------------------------------------------------------------
    // Soft constraints — weights from businessConfig
    // ---------------------------------------------------------------
    const rawSum = bc.weights.cost + bc.weights.fairness + bc.weights.preference;
    const wCost = rawSum > 0 ? bc.weights.cost / rawSum : 0;
    const wFairness = rawSum > 0 ? bc.weights.fairness / rawSum : 0;
    const wPreference = rawSum > 0 ? bc.weights.preference / rawSum : 0;

    const fairness = scoreFairness(input, schedule, bc);
    const cost = scoreCostOptimality(input, schedule);
    const preference = wPreference > 0 ? scorePreference(input, schedule) : 0;

    const composite = fairness * wFairness + cost * wCost + preference * wPreference;

    const tier2Note = tier2.length > 0 ? ` | Tier 2 tolerated: ${tier2.join("; ")}` : "";

    return {
      pass: composite >= 0.55,
      score: composite,
      namedScores: {
        fairness,
        costOptimality: cost,
        preference,
      },
      reason: `Composite: ${composite.toFixed(3)} (fairness=${fairness.toFixed(2)}, cost=${cost.toFixed(2)}, pref=${preference.toFixed(2)}) [weights: fairness=${wFairness.toFixed(3)}, cost=${wCost.toFixed(3)}, pref=${wPreference.toFixed(3)}]${tier2Note}`,
    };
  } catch (e) {
    return {
      pass: false,
      score: 0,
      reason: `Failed to parse schedule output: ${e instanceof Error ? e.message : "unknown error"}`,
    };
  }
}
