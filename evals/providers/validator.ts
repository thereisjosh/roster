/**
 * Deterministic validator between Agent 1 and Agent 2.
 *
 * Reuses core logic from compute-eligibility.js as ground truth to verify
 * Agent 1's structured planning document. Corrections are applied automatically
 * before passing to Agent 2. Agent 1's judgment calls (warnings, recommended
 * assignments, conflict notes) are preserved — only factual errors are overridden.
 */

// --- Types ---

interface AvailabilityWindow {
  day: string;
  startTime: string;
  endTime: string;
}

interface Staff {
  id: string;
  qualifications: string[];
  maxWeeklyHours: number;
  hourlyRate: number;
  level?: string;
  employmentType?: string;
  availability?: AvailabilityWindow[];
  unavailable?: string[];
}

interface Shift {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  requiredRole: string;
  minStaff: number;
  breakMinutes?: number;
}

interface BusinessConfig {
  minShiftHours?: number;
  breakRules?: { name: string; durationMinutes: number }[];
  breakDeduction?: { enabled: boolean; appliesTo: "full-time" | "part-time" | "both" };
  fullTimeHours?: { min: number; target: number; max: number };
  coverageRequirements?: { role: string; days: number[]; startTime: string; endTime: string; minStaff: number }[];
  maxConsecutiveDays?: number;
  closedDays?: number[];
  weights?: { cost: number; fairness: number; preference: number };
}

interface PreferenceRule {
  ruleType: string;
  ruleText: string;
}

interface ScheduleInput {
  shifts: Shift[];
  staff: Staff[];
  businessConfig: BusinessConfig;
  preferenceRules?: PreferenceRule[];
}

// Agent 1 output types
interface EligibilityEntry {
  shiftId: string;
  role: string;
  minStaff: number;
  eligible: string[];
  slack: number;
  status: "FORCED" | "INFEASIBLE" | "NORMAL";
  effectiveStart: string;
  effectiveEnd: string;
  netHours: number;
}

interface HourBudget {
  staffId: string;
  type: string;
  maxHours: number;
  hardCeiling: number;
  forcedHours: number;
  remainingCapacity: number;
  forcedShifts: string[];
}

interface PreSolvedAssignment {
  shiftId: string;
  staffIds: string[];
  reason: string;
}

interface RemainingShift {
  shiftId: string;
  minStaff: number;
  eligible: string[];
  recommendedAssignments?: string[];
  reasoning?: string;
}

export interface Agent1Output {
  eligibilityGuide: EligibilityEntry[];
  hourBudgets: HourBudget[];
  preSolvedAssignments: PreSolvedAssignment[];
  remainingShifts: RemainingShift[];
  conflicts: string[];
  warnings: string[];
}

export interface Correction {
  field: string;
  shiftId?: string;
  staffId?: string;
  type: "missing_staff" | "phantom_staff" | "wrong_status" | "wrong_hours" | "wrong_time_window" | "missing_shift" | "missing_budget";
  expected: unknown;
  actual: unknown;
  action: "override" | "add" | "remove";
}

export interface ValidationResult {
  valid: boolean;
  corrections: Correction[];
  correctedOutput: Agent1Output;
}

// --- Helpers (mirrored from compute-eligibility.js) ---

function parseTimeToHours(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h + m / 60;
}

function isAvailableForShift(s: Staff, shift: Shift, minShiftHours: number = 3): boolean {
  if (!s.availability || s.availability.length === 0) {
    return !(s.unavailable ?? []).includes(shift.id);
  }
  const windows = s.availability.filter((w) => w.day === shift.date);
  if (windows.length === 0) return false;
  let totalOverlap = 0;
  for (const w of windows) {
    const overlapStart = Math.max(parseTimeToHours(w.startTime), parseTimeToHours(shift.startTime));
    const overlapEnd = Math.min(parseTimeToHours(w.endTime), parseTimeToHours(shift.endTime));
    totalOverlap += Math.max(0, overlapEnd - overlapStart);
  }
  return totalOverlap >= minShiftHours;
}

function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

function computeEffectiveTimes(
  shift: Shift,
): { effectiveStart: string; effectiveEnd: string; capped: boolean } {
  return { effectiveStart: shift.startTime, effectiveEnd: shift.endTime, capped: false };
}

function computeNetHours(effectiveStart: string, effectiveEnd: string, breakMinutes?: number): number {
  const startH = parseTimeToHours(effectiveStart);
  const endH = parseTimeToHours(effectiveEnd);
  let hours = endH - startH;
  if (breakMinutes) {
    hours -= breakMinutes / 60;
  }
  return hours;
}

// --- Main Validator ---

export function validate(agent1Output: Agent1Output, rawInput: ScheduleInput): ValidationResult {
  const corrections: Correction[] = [];
  const corrected = JSON.parse(JSON.stringify(agent1Output)) as Agent1Output;

  const shifts = rawInput.shifts;
  const staff = rawInput.staff;
  const bc = rawInput.businessConfig;
  const pr = rawInput.preferenceRules ?? [];
  const minShiftHours = bc.minShiftHours ?? 3;
  const ftHours = bc.fullTimeHours;
  // Build ground truth: eligible staff per shift, effective times, net hours, slack, status
  const groundTruth = new Map<
    string,
    {
      eligible: string[];
      slack: number;
      status: "FORCED" | "INFEASIBLE" | "NORMAL";
      effectiveStart: string;
      effectiveEnd: string;
      netHours: number;
    }
  >();

  for (const shift of shifts) {
    const eligible = staff
      .filter((s) => s.qualifications.includes(shift.requiredRole))
      .filter((s) => isAvailableForShift(s, shift, minShiftHours))
      .map((s) => s.id);
    const { effectiveStart, effectiveEnd } = computeEffectiveTimes(shift);
    const netHours = computeNetHours(effectiveStart, effectiveEnd, shift.breakMinutes);
    const slack = eligible.length - shift.minStaff;
    const status: "FORCED" | "INFEASIBLE" | "NORMAL" = slack === 0 ? "FORCED" : slack < 0 ? "INFEASIBLE" : "NORMAL";
    groundTruth.set(shift.id, { eligible, slack, status, effectiveStart, effectiveEnd, netHours });
  }

  // Compute ground truth forced hours per staff
  const gtForcedHours = new Map<string, { totalHours: number; shifts: string[] }>();
  for (const [shiftId, gt] of groundTruth) {
    if (gt.status === "FORCED" || gt.status === "INFEASIBLE") {
      for (const sid of gt.eligible) {
        const existing = gtForcedHours.get(sid) ?? { totalHours: 0, shifts: [] };
        existing.totalHours += gt.netHours;
        existing.shifts.push(shiftId);
        gtForcedHours.set(sid, existing);
      }
    }
  }

  // --- Check eligibility entries ---

  // Ensure every shift has an entry
  const agent1ShiftIds = new Set(corrected.eligibilityGuide.map((e) => e.shiftId));
  for (const shift of shifts) {
    if (!agent1ShiftIds.has(shift.id)) {
      const gt = groundTruth.get(shift.id)!;
      corrections.push({
        field: "eligibilityGuide",
        shiftId: shift.id,
        type: "missing_shift",
        expected: gt,
        actual: undefined,
        action: "add",
      });
      corrected.eligibilityGuide.push({
        shiftId: shift.id,
        role: shift.requiredRole,
        minStaff: shift.minStaff,
        eligible: gt.eligible,
        slack: gt.slack,
        status: gt.status,
        effectiveStart: gt.effectiveStart,
        effectiveEnd: gt.effectiveEnd,
        netHours: gt.netHours,
      });
    }
  }

  // Validate each eligibility entry
  for (const entry of corrected.eligibilityGuide) {
    const gt = groundTruth.get(entry.shiftId);
    if (!gt) continue;

    // Check eligible staff
    const missingStaff = gt.eligible.filter((s) => !entry.eligible.includes(s));
    const phantomStaff = entry.eligible.filter((s) => !gt.eligible.includes(s));

    if (missingStaff.length > 0) {
      corrections.push({
        field: "eligibilityGuide",
        shiftId: entry.shiftId,
        type: "missing_staff",
        expected: gt.eligible,
        actual: entry.eligible,
        action: "override",
      });
    }
    if (phantomStaff.length > 0) {
      corrections.push({
        field: "eligibilityGuide",
        shiftId: entry.shiftId,
        type: "phantom_staff",
        expected: gt.eligible,
        actual: entry.eligible,
        action: "override",
      });
    }
    if (missingStaff.length > 0 || phantomStaff.length > 0) {
      entry.eligible = [...gt.eligible];
      entry.slack = gt.slack;
    }

    // Check status classification
    if (entry.status !== gt.status) {
      corrections.push({
        field: "eligibilityGuide",
        shiftId: entry.shiftId,
        type: "wrong_status",
        expected: gt.status,
        actual: entry.status,
        action: "override",
      });
      entry.status = gt.status;
      entry.slack = gt.slack;
    }

    // Check effective time windows
    if (entry.effectiveStart !== gt.effectiveStart || entry.effectiveEnd !== gt.effectiveEnd) {
      corrections.push({
        field: "eligibilityGuide",
        shiftId: entry.shiftId,
        type: "wrong_time_window",
        expected: { effectiveStart: gt.effectiveStart, effectiveEnd: gt.effectiveEnd },
        actual: { effectiveStart: entry.effectiveStart, effectiveEnd: entry.effectiveEnd },
        action: "override",
      });
      entry.effectiveStart = gt.effectiveStart;
      entry.effectiveEnd = gt.effectiveEnd;
      entry.netHours = gt.netHours;
    }

    // Check net hours (tolerance 0.1h)
    if (Math.abs(entry.netHours - gt.netHours) > 0.1) {
      corrections.push({
        field: "eligibilityGuide",
        shiftId: entry.shiftId,
        type: "wrong_hours",
        expected: gt.netHours,
        actual: entry.netHours,
        action: "override",
      });
      entry.netHours = gt.netHours;
    }
  }

  // --- Check hour budgets ---

  const agent1StaffIds = new Set(corrected.hourBudgets.map((b) => b.staffId));
  for (const s of staff) {
    const type = s.employmentType === "full-time" ? "full-time" : "part-time";
    const maxH = s.maxWeeklyHours;
    const hardCeiling = type === "full-time" && ftHours ? ftHours.max : maxH;
    const forced = gtForcedHours.get(s.id);
    const forcedH = forced ? forced.totalHours : 0;
    const forcedShifts = forced ? forced.shifts : [];
    const remainingCapacity = Math.max(0, hardCeiling - forcedH);

    if (!agent1StaffIds.has(s.id)) {
      corrections.push({
        field: "hourBudgets",
        staffId: s.id,
        type: "missing_budget",
        expected: { maxH, hardCeiling, forcedH, remainingCapacity },
        actual: undefined,
        action: "add",
      });
      corrected.hourBudgets.push({
        staffId: s.id,
        type,
        maxHours: maxH,
        hardCeiling,
        forcedHours: forcedH,
        remainingCapacity,
        forcedShifts,
      });
      continue;
    }

    const budget = corrected.hourBudgets.find((b) => b.staffId === s.id)!;

    // Check forced hours arithmetic (tolerance 0.1h)
    if (Math.abs(budget.forcedHours - forcedH) > 0.1) {
      corrections.push({
        field: "hourBudgets",
        staffId: s.id,
        type: "wrong_hours",
        expected: forcedH,
        actual: budget.forcedHours,
        action: "override",
      });
      budget.forcedHours = forcedH;
      budget.forcedShifts = forcedShifts;
      budget.remainingCapacity = remainingCapacity;
    }

    // Ensure hard ceiling is correct
    if (budget.hardCeiling !== hardCeiling) {
      budget.hardCeiling = hardCeiling;
    }
    if (budget.maxHours !== maxH) {
      budget.maxHours = maxH;
    }
  }

  // --- Rebuild pre-solved and remaining from corrected eligibility ---

  const correctedPreSolved: PreSolvedAssignment[] = [];
  const correctedRemaining: RemainingShift[] = [];

  for (const entry of corrected.eligibilityGuide) {
    if (entry.status === "FORCED" || entry.status === "INFEASIBLE") {
      correctedPreSolved.push({
        shiftId: entry.shiftId,
        staffIds: [...entry.eligible],
        reason: entry.status,
      });
    } else {
      // Preserve Agent 1's recommendations if the shift exists
      const existing = corrected.remainingShifts.find((r) => r.shiftId === entry.shiftId);
      correctedRemaining.push({
        shiftId: entry.shiftId,
        minStaff: entry.minStaff,
        eligible: [...entry.eligible],
        recommendedAssignments: existing?.recommendedAssignments?.filter((s) =>
          entry.eligible.includes(s),
        ),
        reasoning: existing?.reasoning,
      });
    }
  }

  corrected.preSolvedAssignments = correctedPreSolved;
  corrected.remainingShifts = correctedRemaining;

  return {
    valid: corrections.length === 0,
    corrections,
    correctedOutput: corrected,
  };
}
