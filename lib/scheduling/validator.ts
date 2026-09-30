/**
 * Shared schedule validation logic.
 *
 * Hard constraint checkers used by both:
 * - The runtime generation pipeline (post-LLM validation)
 * - The eval scorer (promptfoo quality scoring)
 */

// ---------------------------------------------------------------------------
// Interfaces — shared between eval golden data and runtime pipeline
// ---------------------------------------------------------------------------

export interface Assignment {
  shiftId: string;
  staffId: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  role?: string;
}

export interface Shift {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  requiredRole: string;
  minStaff: number;
  maxStaff?: number;
  breakMinutes?: number; // break time deducted from hours calculations
}

export interface AvailabilityWindow {
  day: string;      // ISO date (e.g., "2026-02-23")
  startTime: string; // HH:mm
  endTime: string;   // HH:mm
  preference?: "preferred" | "available";
}

export interface Staff {
  id: string;
  qualifications: string[];
  maxWeeklyHours: number;
  hourlyRate: number;
  unavailable: string[];            // DEPRECATED — backward compat
  availability?: AvailabilityWindow[]; // time-range availability
  level?: "L1" | "L2" | "manager";
  employmentType?: "full-time" | "part-time";
}

export interface ScheduleInput {
  shifts: Shift[];
  staff: Staff[];
  constraints: { minRestHours: number; maxConsecutiveDays: number };
}

export interface ScheduleOutput {
  assignments: Assignment[];
  unfilledShifts?: string[];
  warnings?: string[];
  metadata?: {
    totalStaffHours?: number;
    totalLaborCost?: number;
    coveragePercent?: number;
  };
}

export interface HardConstraintResult {
  passed: boolean;
  violations: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function parseTimeToHours(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h + m / 60;
}

export function shiftWorkedHours(shift: Shift): number {
  const gross = parseTimeToHours(shift.endTime) - parseTimeToHours(shift.startTime);
  return gross - (shift.breakMinutes ?? 0) / 60;
}

export function assignmentWorkedHours(assignment: Assignment, shift: Shift): number {
  const start = assignment.startTime ?? shift.startTime;
  const end = assignment.endTime ?? shift.endTime;
  const gross = parseTimeToHours(end) - parseTimeToHours(start);
  return gross - (shift.breakMinutes ?? 0) / 60;
}

export function calculateGini(values: number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  if (mean === 0) return 0;

  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += (2 * (i + 1) - n - 1) * sorted[i];
  }
  return sum / (n * n * mean);
}

// ---------------------------------------------------------------------------
// Time-range availability helpers
// ---------------------------------------------------------------------------

/**
 * Computes the overlap in hours between two time ranges on the same day.
 */
function timeOverlapHours(
  aStart: string, aEnd: string,
  bStart: string, bEnd: string,
): number {
  const aS = parseTimeToHours(aStart);
  const aE = parseTimeToHours(aEnd);
  const bS = parseTimeToHours(bStart);
  const bE = parseTimeToHours(bEnd);
  const overlapStart = Math.max(aS, bS);
  const overlapEnd = Math.min(aE, bE);
  return Math.max(0, overlapEnd - overlapStart);
}

/**
 * Can this person work at least `minShiftHours` of this shift?
 * Falls back to `!staff.unavailable.includes(shift.id)` when `availability` is undefined.
 */
export function isAvailableForShift(
  staff: Staff,
  shift: Shift,
  minShiftHours: number = 3,
): boolean {
  if (!staff.availability || staff.availability.length === 0) {
    return !staff.unavailable.includes(shift.id);
  }

  const shiftDate = shift.date;
  const windows = staff.availability.filter((w) => w.day === shiftDate);
  if (windows.length === 0) return false;

  // Sum overlap across all availability windows on this date
  let totalOverlap = 0;
  for (const w of windows) {
    totalOverlap += timeOverlapHours(w.startTime, w.endTime, shift.startTime, shift.endTime);
  }

  return totalOverlap >= minShiftHours;
}

/**
 * What hours should this person work? Returns the intersection of staff
 * availability and shift window. Returns null if overlap < minShiftHours.
 */
export function computeAssignmentWindow(
  staff: Staff,
  shift: Shift,
  minShiftHours: number = 3,
): { startTime: string; endTime: string } | null {
  if (!staff.availability || staff.availability.length === 0) {
    if (staff.unavailable.includes(shift.id)) return null;
    return { startTime: shift.startTime, endTime: shift.endTime };
  }

  const windows = staff.availability.filter((w) => w.day === shift.date);
  if (windows.length === 0) return null;

  // Find the best single window (largest overlap)
  let bestStart = "";
  let bestEnd = "";
  let bestOverlap = 0;

  for (const w of windows) {
    const overlapStart = Math.max(parseTimeToHours(w.startTime), parseTimeToHours(shift.startTime));
    const overlapEnd = Math.min(parseTimeToHours(w.endTime), parseTimeToHours(shift.endTime));
    const overlap = overlapEnd - overlapStart;
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      const startH = Math.floor(overlapStart);
      const startM = Math.round((overlapStart - startH) * 60);
      const endH = Math.floor(overlapEnd);
      const endM = Math.round((overlapEnd - endH) * 60);
      bestStart = `${String(startH).padStart(2, "0")}:${String(startM).padStart(2, "0")}`;
      bestEnd = `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
    }
  }

  if (bestOverlap < minShiftHours) return null;
  return { startTime: bestStart, endTime: bestEnd };
}

export interface HourlyCoverageGap {
  shiftId: string;
  hour: number; // e.g., 11 for 11:00-12:00
  required: number;
  actual: number;
}

/** Config needed by checkHourlyCoverage for role time windows and feasibility. */
export interface HourlyCoverageConfig {
  coverageRequirements?: {
    role: string;
    days: number[];
    startTime: string;
    endTime: string;
    minStaff: number;
  }[];
  closedDays?: number[];
}

/**
 * Checks that every hour within each shift's coverage window has enough staff,
 * counting by startTime/endTime overlap (not shiftId matching).
 * Skips infeasible slots.
 */
export function checkHourlyCoverage(
  shifts: Shift[],
  assignments: Assignment[],
  shiftMap?: Map<string, Shift>,
  config?: HourlyCoverageConfig,
  staff?: Staff[],
): { passed: boolean; violations: string[]; gaps: HourlyCoverageGap[] } {
  const sMap = shiftMap ?? new Map(shifts.map((s) => [s.id, s]));
  const violations: string[] = [];
  const gaps: HourlyCoverageGap[] = [];
  const closedDays = config?.closedDays ?? [];

  for (const shift of shifts) {
    // Skip closed days
    const dow = new Date(shift.date + "T00:00:00Z").getUTCDay();
    if (closedDays.includes(dow)) continue;

    const startH = Math.floor(parseTimeToHours(shift.startTime));
    const endH = Math.ceil(parseTimeToHours(shift.endTime));

    for (let hour = startH; hour < endH; hour++) {
      // Feasibility check: skip if not enough eligible staff exist for this hour
      if (staff && staff.length > 0) {
        let eligibleCount = 0;
        for (const s of staff) {
          if (!s.qualifications.includes(shift.requiredRole)) continue;
          if (s.availability && s.availability.length > 0) {
            const avail = s.availability.some((w) => {
              if (w.day !== shift.date) return false;
              const ws = parseTimeToHours(w.startTime);
              const we = parseTimeToHours(w.endTime);
              return ws <= hour + 0.001 && we >= hour + 1 - 0.001;
            });
            if (!avail) continue;
          }
          eligibleCount++;
        }
        if (eligibleCount < shift.minStaff) continue; // infeasible slot
      }

      // Count ALL assignments active at this hour on this date for this role
      // (regardless of shiftId — handles cross-shift-boundary staff)
      let count = 0;
      for (const a of assignments) {
        const aShift = sMap.get(a.shiftId);
        // Must match date and role
        const aDate = a.date ?? aShift?.date;
        const aRole = a.role ?? aShift?.requiredRole;
        if (aDate !== shift.date || aRole !== shift.requiredRole) continue;

        const aStart = parseTimeToHours(a.startTime ?? aShift?.startTime ?? "00:00");
        const aEnd = parseTimeToHours(a.endTime ?? aShift?.endTime ?? "00:00");
        if (aStart <= hour && aEnd > hour) {
          count++;
        }
      }

      if (count < shift.minStaff) {
        const gap: HourlyCoverageGap = {
          shiftId: shift.id,
          hour,
          required: shift.minStaff,
          actual: count,
        };
        gaps.push(gap);
        violations.push(
          `Shift ${shift.id} hour ${hour}:00-${hour + 1}:00: need ${shift.minStaff} staff, got ${count}`,
        );
      }
    }
  }

  return { passed: violations.length === 0, violations, gaps };
}

// ---------------------------------------------------------------------------
// Hard Constraints
// ---------------------------------------------------------------------------

export function checkCoverage(input: ScheduleInput, output: ScheduleOutput): HardConstraintResult {
  const violations: string[] = [];
  for (const shift of input.shifts) {
    const assigned = output.assignments.filter((a) => a.shiftId === shift.id);
    if (assigned.length < shift.minStaff) {
      violations.push(`Shift ${shift.id} needs ${shift.minStaff} staff, got ${assigned.length}`);
    }
  }
  return { passed: violations.length === 0, violations };
}

export function checkQualifications(input: ScheduleInput, output: ScheduleOutput): HardConstraintResult {
  const violations: string[] = [];
  const staffMap = new Map(input.staff.map((s) => [s.id, s]));
  const shiftMap = new Map(input.shifts.map((s) => [s.id, s]));

  for (const assignment of output.assignments) {
    const staff = staffMap.get(assignment.staffId);
    const shift = shiftMap.get(assignment.shiftId);
    if (staff && shift && shift.requiredRole && !staff.qualifications.includes(shift.requiredRole)) {
      violations.push(`${assignment.staffId} not qualified for ${shift.requiredRole} (shift ${shift.id})`);
    }
  }
  return { passed: violations.length === 0, violations };
}

export function checkHoursCompliance(
  input: ScheduleInput,
  output: ScheduleOutput,
  breakConfig?: { breakRules?: { durationMinutes: number }[]; breakDeduction?: { enabled: boolean; appliesTo: string } },
): HardConstraintResult {
  const violations: string[] = [];
  const staffMap = new Map(input.staff.map((s) => [s.id, s]));
  const shiftMap = new Map(input.shifts.map((s) => [s.id, s]));
  const hoursPerStaff: Record<string, number> = {};
  const daysPerStaff: Record<string, Set<string>> = {};

  for (const assignment of output.assignments) {
    const shift = shiftMap.get(assignment.shiftId);
    if (!shift) continue;
    const hours = assignmentWorkedHours(assignment, shift);
    hoursPerStaff[assignment.staffId] = (hoursPerStaff[assignment.staffId] ?? 0) + hours;
    if (!daysPerStaff[assignment.staffId]) daysPerStaff[assignment.staffId] = new Set();
    daysPerStaff[assignment.staffId].add(shift.date);
  }

  // Break deduction per day
  const breakPerDay = breakConfig?.breakRules
    ? breakConfig.breakRules.reduce((sum, b) => sum + b.durationMinutes, 0) / 60
    : 0;
  const deductionEnabled = breakConfig?.breakDeduction?.enabled ?? false;
  const appliesTo = breakConfig?.breakDeduction?.appliesTo ?? "both";

  for (const [staffId, grossHours] of Object.entries(hoursPerStaff)) {
    const staff = staffMap.get(staffId);
    if (!staff) continue;

    // Determine if break deduction applies to this staff member
    let deduct = false;
    if (deductionEnabled && breakPerDay > 0) {
      if (appliesTo === "both") deduct = true;
      else if (appliesTo === "full-time") deduct = staff.employmentType === "full-time";
      else if (appliesTo === "part-time") deduct = staff.employmentType === "part-time";
    }

    const daysWorked = daysPerStaff[staffId]?.size ?? 0;
    const netHours = deduct ? Math.max(0, grossHours - breakPerDay * daysWorked) : grossHours;

    if (netHours > staff.maxWeeklyHours) {
      violations.push(`${staffId} assigned ${netHours.toFixed(1)}h (net), max is ${staff.maxWeeklyHours}h`);
    }
  }
  return { passed: violations.length === 0, violations };
}

export function checkAvailability(input: ScheduleInput, output: ScheduleOutput): HardConstraintResult {
  const violations: string[] = [];
  const staffMap = new Map(input.staff.map((s) => [s.id, s]));
  const shiftMap = new Map(input.shifts.map((s) => [s.id, s]));

  for (const assignment of output.assignments) {
    const staff = staffMap.get(assignment.staffId);
    const shift = shiftMap.get(assignment.shiftId);
    if (!staff) continue;

    if (staff.availability && staff.availability.length > 0 && shift) {
      // Time-range check: verify the assignment's actual window falls within availability
      const aStart = assignment.startTime ?? shift.startTime;
      const aEnd = assignment.endTime ?? shift.endTime;
      const windows = staff.availability.filter((w) => w.day === shift.date);
      if (windows.length === 0) {
        violations.push(`${assignment.staffId} assigned to ${assignment.shiftId} but has no availability on ${shift.date}`);
        continue;
      }
      // Check that the assignment window is covered by at least one availability window
      const covered = windows.some((w) => {
        const wStart = parseTimeToHours(w.startTime);
        const wEnd = parseTimeToHours(w.endTime);
        const assignStart = parseTimeToHours(aStart);
        const assignEnd = parseTimeToHours(aEnd);
        return wStart <= assignStart && wEnd >= assignEnd;
      });
      if (!covered) {
        violations.push(
          `${assignment.staffId} assigned to ${assignment.shiftId} (${aStart}-${aEnd}) but availability doesn't cover this window`,
        );
      }
    } else {
      // Fallback: shift-ID based check
      if (staff.unavailable.includes(assignment.shiftId)) {
        violations.push(`${assignment.staffId} assigned to ${assignment.shiftId} but marked unavailable`);
      }
    }
  }
  return { passed: violations.length === 0, violations };
}

export function checkRestPeriods(input: ScheduleInput, output: ScheduleOutput): HardConstraintResult {
  const violations: string[] = [];
  const shiftMap = new Map(input.shifts.map((s) => [s.id, s]));
  const minRest = input.constraints.minRestHours;

  // Group assignments by staff, preserving assignment-level time overrides
  const byStaff: Record<string, { shift: Shift; assignment: Assignment }[]> = {};
  for (const assignment of output.assignments) {
    const shift = shiftMap.get(assignment.shiftId);
    if (!shift) continue;
    if (!byStaff[assignment.staffId]) byStaff[assignment.staffId] = [];
    byStaff[assignment.staffId].push({ shift, assignment });
  }

  for (const [staffId, entries] of Object.entries(byStaff)) {
    const sorted = entries.sort((a, b) => {
      const startA = a.assignment.startTime ?? a.shift.startTime;
      const startB = b.assignment.startTime ?? b.shift.startTime;
      const dateA = `${a.shift.date}T${startA}`;
      const dateB = `${b.shift.date}T${startB}`;
      return dateA.localeCompare(dateB);
    });

    for (let i = 1; i < sorted.length; i++) {
      // Skip rest check for same-day shifts (treated as continuous work block)
      if (sorted[i].shift.date === sorted[i - 1].shift.date) continue;

      const prevEnd = sorted[i - 1].assignment.endTime ?? sorted[i - 1].shift.endTime;
      const currStart = sorted[i].assignment.startTime ?? sorted[i].shift.startTime;
      const prevEndDate = new Date(`${sorted[i - 1].shift.date}T${prevEnd}`);
      const currStartDate = new Date(`${sorted[i].shift.date}T${currStart}`);
      const restHours = (currStartDate.getTime() - prevEndDate.getTime()) / (1000 * 60 * 60);
      if (restHours < minRest) {
        violations.push(`${staffId}: only ${restHours}h rest between ${sorted[i - 1].shift.id} and ${sorted[i].shift.id} (min ${minRest}h)`);
      }
    }
  }
  return { passed: violations.length === 0, violations };
}

export function checkConsecutiveDays(input: ScheduleInput, output: ScheduleOutput): HardConstraintResult {
  const violations: string[] = [];
  const shiftMap = new Map(input.shifts.map((s) => [s.id, s]));
  const maxConsecutive = input.constraints.maxConsecutiveDays;

  // Group unique work dates by staff
  const datesByStaff: Record<string, Set<string>> = {};
  for (const assignment of output.assignments) {
    const shift = shiftMap.get(assignment.shiftId);
    if (!shift) continue;
    if (!datesByStaff[assignment.staffId]) datesByStaff[assignment.staffId] = new Set();
    datesByStaff[assignment.staffId].add(shift.date);
  }

  for (const [staffId, dateSet] of Object.entries(datesByStaff)) {
    const dates = [...dateSet].sort();
    let longest = 1;
    let current = 1;

    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(dates[i - 1]);
      const curr = new Date(dates[i]);
      const diffDays = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);

      if (diffDays === 1) {
        current++;
        longest = Math.max(longest, current);
      } else {
        current = 1;
      }
    }

    if (longest > maxConsecutive) {
      violations.push(`${staffId}: ${longest} consecutive days worked, max is ${maxConsecutive}`);
    }
  }

  return { passed: violations.length === 0, violations };
}

// ---------------------------------------------------------------------------
// Relationship checks (near-hard constraints)
// ---------------------------------------------------------------------------

export interface RelationshipForValidation {
  staffId1: string;
  staffId2: string | null;
  semantics: "separate" | "pair";
  label: string;
  weight: number;
  confirmed: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Check relationship constraints based on generic semantics.
 * - `separate` + co-assigned → violation. Hard failure only if confirmed + weight >= 5.
 * - `pair` + not co-assigned → warning only, never hard failure.
 * Validator never inspects `metadata` — that's LLM context, not enforcement rules.
 */
export function checkRelationshipConstraints(
  input: ScheduleInput,
  output: ScheduleOutput,
  relationships: RelationshipForValidation[],
): { violations: string[]; isHard: boolean } {
  const violations: string[] = [];
  const shiftMap = new Map(input.shifts.map((s) => [s.id, s]));
  let hasHardViolation = false;

  // Check "separate" relationships — should not be co-assigned
  const separatePairs = relationships.filter(
    (r) => r.semantics === "separate" && r.staffId2 !== null && (r.confirmed || r.weight >= 3),
  );

  for (const pair of separatePairs) {
    const staff1Assignments = output.assignments.filter((a) => a.staffId === pair.staffId1);
    const staff2Assignments = output.assignments.filter((a) => a.staffId === pair.staffId2);

    for (const a1 of staff1Assignments) {
      const s1 = shiftMap.get(a1.shiftId);
      if (!s1) continue;

      for (const a2 of staff2Assignments) {
        const s2 = shiftMap.get(a2.shiftId);
        if (!s2) continue;
        if (s1.date !== s2.date) continue;

        const a1Start = parseTimeToHours(a1.startTime ?? s1.startTime);
        const a1End = parseTimeToHours(a1.endTime ?? s1.endTime);
        const a2Start = parseTimeToHours(a2.startTime ?? s2.startTime);
        const a2End = parseTimeToHours(a2.endTime ?? s2.endTime);

        if (a1Start < a2End && a2Start < a1End) {
          violations.push(
            `"${pair.label}" pair ${pair.staffId1} and ${pair.staffId2} co-assigned on ${s1.date} ` +
            `(${a1.startTime ?? s1.startTime}-${a1.endTime ?? s1.endTime} overlaps ` +
            `${a2.startTime ?? s2.startTime}-${a2.endTime ?? s2.endTime})`,
          );
          if (pair.confirmed && pair.weight >= 5) {
            hasHardViolation = true;
          }
        }
      }
    }
  }

  // Check "pair" relationships — should be co-assigned (warning only)
  const pairRels = relationships.filter(
    (r) => r.semantics === "pair" && r.staffId2 !== null && r.confirmed,
  );

  for (const pair of pairRels) {
    const staff1Dates = new Set(
      output.assignments
        .filter((a) => a.staffId === pair.staffId1)
        .map((a) => {
          const s = shiftMap.get(a.shiftId);
          return s?.date;
        })
        .filter(Boolean),
    );
    const staff2Dates = new Set(
      output.assignments
        .filter((a) => a.staffId === pair.staffId2)
        .map((a) => {
          const s = shiftMap.get(a.shiftId);
          return s?.date;
        })
        .filter(Boolean),
    );

    // If both are scheduled but never on the same day, warn
    if (staff1Dates.size > 0 && staff2Dates.size > 0) {
      const overlap = [...staff1Dates].some((d) => staff2Dates.has(d));
      if (!overlap) {
        violations.push(
          `"${pair.label}" pair ${pair.staffId1} and ${pair.staffId2} are both scheduled but never co-assigned`,
        );
        // pair violations are never hard failures
      }
    }
  }

  return { violations, isHard: hasHardViolation };
}

// ---------------------------------------------------------------------------
// Shift composition checks (skill-based team requirements)
// ---------------------------------------------------------------------------

export interface CompositionViolation {
  shiftType: string;
  tag: string;
  required: number;
  actual: number;
  alternatives: string[];
  isHard: boolean;
  conditionTriggeredBy?: string;
}

export interface StaffSkillForValidation {
  staffId: string;
  tag: string;
  proficiency: number;
}

export interface CompositionRuleForValidation {
  shiftType: string | null;
  tag: string;
  minimumCount: number;
  minProficiency: number;
  required: boolean;
  condition?: { whenTagPresent?: string; whenMinCount?: number } | null;
}

/**
 * Check that shifts have the required team composition based on skill tags.
 * Counts tagged staff per shift against minimumCount.
 */
export function checkShiftComposition(
  assignments: Assignment[],
  staffSkills: StaffSkillForValidation[],
  rules: CompositionRuleForValidation[],
  shiftType: string,
): CompositionViolation[] {
  const violations: CompositionViolation[] = [];

  const applicableRules = rules.filter(
    (r) => r.shiftType === null || r.shiftType === shiftType,
  );

  for (const rule of applicableRules) {
    // Find staff assigned to this shift type who have the required tag
    const assignedStaffIds = new Set(
      assignments
        .filter((a) => a.role === shiftType)
        .map((a) => a.staffId),
    );

    // Check condition — is the trigger satisfied?
    if (rule.condition?.whenTagPresent) {
      const triggerCount = [...assignedStaffIds].filter((staffId) =>
        staffSkills.some(
          (sk) => sk.staffId === staffId && sk.tag === rule.condition!.whenTagPresent,
        ),
      ).length;
      const triggerThreshold = rule.condition.whenMinCount ?? 1;
      if (triggerCount < triggerThreshold) continue; // Condition not met — skip
    }

    const qualifiedAssigned = [...assignedStaffIds].filter((staffId) =>
      staffSkills.some(
        (sk) =>
          sk.staffId === staffId &&
          sk.tag === rule.tag &&
          sk.proficiency >= rule.minProficiency,
      ),
    );

    if (qualifiedAssigned.length < rule.minimumCount) {
      // Find alternatives — staff who have the tag but aren't assigned
      const alternatives = staffSkills
        .filter(
          (sk) =>
            sk.tag === rule.tag &&
            sk.proficiency >= rule.minProficiency &&
            !assignedStaffIds.has(sk.staffId),
        )
        .map((sk) => sk.staffId);

      violations.push({
        shiftType,
        tag: rule.tag,
        required: rule.minimumCount,
        actual: qualifiedAssigned.length,
        alternatives,
        isHard: rule.required,
        ...(rule.condition?.whenTagPresent ? { conditionTriggeredBy: rule.condition.whenTagPresent } : {}),
      });
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Run all hard constraints at once
// ---------------------------------------------------------------------------

export function validateHardConstraints(
  input: ScheduleInput,
  output: ScheduleOutput,
  breakConfig?: { breakRules?: { durationMinutes: number }[]; breakDeduction?: { enabled: boolean; appliesTo: string } },
  relationships?: RelationshipForValidation[],
): { passed: boolean; violations: string[]; relationshipWarnings?: string[] } {
  const coverage = checkHourlyCoverage(input.shifts, output.assignments);
  const qualifications = checkQualifications(input, output);
  const hours = checkHoursCompliance(input, output, breakConfig);
  const availability = checkAvailability(input, output);
  const rest = checkRestPeriods(input, output);
  const consecutive = checkConsecutiveDays(input, output);

  const allViolations = [
    ...coverage.violations,
    ...qualifications.violations,
    ...hours.violations,
    ...availability.violations,
    ...rest.violations,
    ...consecutive.violations,
  ];

  let passed =
    coverage.passed &&
    qualifications.passed &&
    hours.passed &&
    availability.passed &&
    rest.passed &&
    consecutive.passed;

  // Relationship checks (near-hard tier)
  const relationshipWarnings: string[] = [];
  if (relationships && relationships.length > 0) {
    const relResult = checkRelationshipConstraints(input, output, relationships);
    relationshipWarnings.push(...relResult.violations);

    if (relResult.isHard) {
      allViolations.push(...relationshipWarnings);
      passed = false;
    }
  }

  return {
    passed,
    violations: allViolations,
    relationshipWarnings: relationshipWarnings.length > 0 ? relationshipWarnings : undefined,
  };
}
