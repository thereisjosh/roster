/**
 * Slot-level scorer for promptfoo evals.
 *
 * Compares LLM output (in slot format) against golden expected slots.
 *
 * Metrics:
 *   slotRecall         — % of golden slots recovered
 *   slotPrecision      — % of LLM slots that exist in golden
 *   slotExactMatch     — % of slot-hours with identical staff sets
 *   staffUtilization   — % of staff with >= 1 assignment
 *   coverageCompleteness — % of required slot-hours with >= minStaff assigned
 *
 * Pass criteria: hoursCompliance === 1.0 && minStaffCoverage >= 0.95 && eligibilityCompliance >= 0.98
 */

interface Slot {
  slotId: string;
  staffId: string;
  date: string;
  hour: number;
  role?: string;
}

interface SlotOutput {
  slots: Slot[];
}

interface ScorerResult {
  pass: boolean;
  score: number;
  namedScores?: Record<string, number>;
  reason: string;
}

function buildSlotStaffMap(slots: Slot[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const s of slots) {
    const key = `${s.slotId}::${s.staffId}`;
    if (!map.has(s.slotId)) {
      map.set(s.slotId, new Set());
    }
    map.get(s.slotId)!.add(s.staffId);
  }
  return map;
}

export default function slotScorer(
  output: string,
  context: { vars: { reference?: string; input?: string } },
): ScorerResult {
  try {
    const schedule: SlotOutput = JSON.parse(output);
    const referenceRaw = context.vars.reference;

    if (!referenceRaw) {
      return { pass: false, score: 0, reason: 'No reference provided in context.vars.reference' };
    }

    const reference: SlotOutput = JSON.parse(referenceRaw);

    if (!reference.slots || reference.slots.length === 0) {
      return { pass: false, score: 0, reason: 'Reference has no slots' };
    }

    if (!schedule.slots || schedule.slots.length === 0) {
      return { pass: false, score: 0, reason: 'LLM output has no slots' };
    }

    // Build pair sets for recall/precision
    const goldenPairs = new Set(reference.slots.map(s => `${s.slotId}::${s.staffId}`));
    const llmPairs = new Set(schedule.slots.map(s => `${s.slotId}::${s.staffId}`));

    let recallHits = 0;
    for (const pair of goldenPairs) {
      if (llmPairs.has(pair)) recallHits++;
    }
    const slotRecall = goldenPairs.size > 0 ? recallHits / goldenPairs.size : 0;

    let precisionHits = 0;
    for (const pair of llmPairs) {
      if (goldenPairs.has(pair)) precisionHits++;
    }
    const slotPrecision = llmPairs.size > 0 ? precisionHits / llmPairs.size : 0;

    // Exact match per slot-hour: identical staff sets
    const goldenMap = buildSlotStaffMap(reference.slots);
    const llmMap = buildSlotStaffMap(schedule.slots);

    let exactMatches = 0;
    let totalSlotHours = 0;
    for (const [slotId, goldenStaff] of goldenMap) {
      totalSlotHours++;
      const llmStaff = llmMap.get(slotId) ?? new Set<string>();
      if (goldenStaff.size === llmStaff.size) {
        let allMatch = true;
        for (const s of goldenStaff) {
          if (!llmStaff.has(s)) { allMatch = false; break; }
        }
        if (allMatch) exactMatches++;
      }
    }
    const slotExactMatch = totalSlotHours > 0 ? exactMatches / totalSlotHours : 0;

    // Reference overlap: weighted recall where each slot-hour is weighted by golden staff count
    let totalWeight = 0;
    let weightedScore = 0;
    for (const [slotId, goldenStaff] of goldenMap) {
      const weight = goldenStaff.size;
      totalWeight += weight;
      const llmStaff = llmMap.get(slotId) ?? new Set<string>();
      let intersection = 0;
      for (const s of goldenStaff) {
        if (llmStaff.has(s)) intersection++;
      }
      weightedScore += (goldenStaff.size > 0 ? intersection / goldenStaff.size : 1) * weight;
    }
    const referenceOverlap = totalWeight > 0 ? weightedScore / totalWeight : 0;

    // Staff utilization
    let totalStaff = 0;
    let inputData: any = null;
    if (context.vars.input) {
      try {
        inputData = JSON.parse(context.vars.input);
        totalStaff = inputData.staff?.length ?? 0;
      } catch { /* ignore */ }
    }
    const activeStaff = new Set(schedule.slots.map(s => s.staffId));
    const staffUtilization = totalStaff > 0 ? activeStaff.size / totalStaff : 0;

    // Coverage completeness: % of golden slot-hours that have >= same number of staff in LLM output
    let coveredSlots = 0;
    for (const [slotId, goldenStaff] of goldenMap) {
      const llmStaff = llmMap.get(slotId);
      if (llmStaff && llmStaff.size >= goldenStaff.size) {
        coveredSlots++;
      }
    }
    const coverageCompleteness = totalSlotHours > 0 ? coveredSlots / totalSlotHours : 0;

    // Hours compliance validation
    let hoursCompliance = 1.0;
    let ftHoursMin = Infinity;
    const hourViolations: string[] = [];

    if (inputData) {
      const bc = inputData.businessConfig;
      const staffList: any[] = inputData.staff ?? [];
      const ftHours = bc?.fullTimeHours;
      const breakRules: any[] = bc?.breakRules ?? [];

      // Total break deduction per work-day (in hours)
      const breakDeductMinutes = breakRules.reduce(
        (sum: number, b: any) => sum + b.durationMinutes, 0
      );
      const breakDeductHours = breakDeductMinutes / 60;
      const breakDeductionEnabled = bc?.breakDeduction?.enabled ?? false;
      const breakAppliesTo = bc?.breakDeduction?.appliesTo ?? "both";

      // Group LLM slots by staffId + date to find work-days and gross hours
      const staffDayHours = new Map<string, Map<string, number>>();
      for (const slot of schedule.slots) {
        if (!staffDayHours.has(slot.staffId)) {
          staffDayHours.set(slot.staffId, new Map());
        }
        const dayMap = staffDayHours.get(slot.staffId)!;
        const date = slot.date ?? slot.slotId.split('-').slice(0, 3).join('-');
        dayMap.set(date, (dayMap.get(date) ?? 0) + 1);
      }

      // Compute net hours per staff and check constraints
      for (const s of staffList) {
        const dayMap = staffDayHours.get(s.id);
        if (!dayMap) {
          // Staff not scheduled at all
          if (s.employmentType === 'full-time' && ftHours) {
            // Check if staff has any eligible days (skip if on leave)
            const shifts: any[] = inputData.shifts ?? [];
            // Count eligible dates
            let eligDays = 0;
            for (const shift of shifts) {
              if (!s.qualifications?.includes(shift.requiredRole)) continue;
              if (s.availability && s.availability.length > 0) {
                if (s.availability.some((w: any) => w.day === shift.date)) { eligDays++; break; }
              } else if (!s.availability) {
                eligDays++; break;
              }
            }
            if (eligDays === 0) continue; // leave week — skip
            hoursCompliance = 0.0;
            ftHoursMin = 0;
            hourViolations.push(`${s.id}: full-time not scheduled (need ${ftHours.min}h min)`);
          }
          continue;
        }

        const daysWorked = dayMap.size;
        let grossHours = 0;
        dayMap.forEach((h) => { grossHours += h; });
        const shouldDeduct = breakDeductionEnabled && (
          breakAppliesTo === "both" ||
          (breakAppliesTo === "full-time" && s.employmentType === "full-time") ||
          (breakAppliesTo === "part-time" && s.employmentType === "part-time")
        );
        const netHours = shouldDeduct ? grossHours - (daysWorked * breakDeductHours) : grossHours;

        if (s.employmentType === 'full-time' && ftHours) {
          if (netHours < ftHoursMin) ftHoursMin = netHours;

          // Compute max possible net hours for this FT staff member
          const shifts: any[] = inputData.shifts ?? [];
          const parseTime = (t: string) => { const [hh, mm] = t.split(':').map(Number); return hh + mm / 60; };

          const eligSlotKeys = new Set<string>();
          const eligDateSlots = new Map<string, number>();
          for (const shift of shifts) {
            if (!s.qualifications?.includes(shift.requiredRole)) continue;
            const cappedStart = parseTime(shift.startTime);
            const cappedEnd = parseTime(shift.endTime);
            const firstH = Math.ceil(cappedStart - 0.001);
            const lastH = Math.ceil(cappedEnd - 0.001) - 1;
            for (let h = firstH; h <= lastH; h++) {
              if (s.availability && s.availability.length > 0) {
                const avail = s.availability.some((w: any) => {
                  if (w.day !== shift.date) return false;
                  const ws = parseTime(w.startTime);
                  const we = parseTime(w.endTime);
                  return ws <= h + 0.001 && we >= h + 1 - 0.001;
                });
                if (!avail) continue;
              }
              eligSlotKeys.add(`${shift.date}-${h}`);
              if (!eligDateSlots.has(shift.date)) eligDateSlots.set(shift.date, 0);
            }
          }
          // Count unique slots per date for break deduction
          for (const key of eligSlotKeys) {
            const date = key.substring(0, key.lastIndexOf('-'));
            eligDateSlots.set(date, (eligDateSlots.get(date) ?? 0) + 1);
          }
          const maxPossibleDays = eligDateSlots.size;
          const maxPossibleNet = eligSlotKeys.size - (maxPossibleDays * breakDeductHours);

          if (maxPossibleNet < ftHours.min) {
            // Constraint is physically unsatisfiable — skip
          } else if (netHours < ftHours.min) {
            hoursCompliance = 0.0;
            hourViolations.push(`${s.id}: ${netHours.toFixed(1)}h net < ${ftHours.min}h min`);
          }
          if (netHours > ftHours.max) {
            hoursCompliance = 0.0;
            hourViolations.push(`${s.id}: ${netHours.toFixed(1)}h net > ${ftHours.max}h max`);
          }
        } else {
          // Part-time: maxWeeklyHours is a computed artifact, not a real business constraint
        }
      }
    }

    if (ftHoursMin === Infinity) ftHoursMin = -1; // no full-time staff

    // --- minStaffCoverage: % of required slot-hours where assigned staff >= minStaff ---
    let minStaffCoverage = 1.0;
    let totalRequiredSlots = 0;
    let slotsMetMin = 0;
    const minStaffViolations: string[] = [];

    if (inputData) {
      const bc = inputData.businessConfig;
      const coverageReqs: any[] = bc?.coverageRequirements ?? [];
      const closedDays: number[] = bc?.closedDays ?? [];
      const weekStart: string = inputData.weekStart;
      const parseTime = (t: string) => { const [hh, mm] = t.split(':').map(Number); return hh + mm / 60; };

      if (coverageReqs.length > 0 && weekStart) {
        // Map JS day-of-week (0=Sun) to actual dates in the week
        const weekStartDate = new Date(weekStart + 'T00:00:00Z');
        const startDow = weekStartDate.getUTCDay(); // 0=Sun
        const dowToDate = new Map<number, string>();
        for (let i = 0; i < 7; i++) {
          const d = new Date(weekStartDate.getTime() + i * 86400000);
          dowToDate.set(d.getUTCDay(), d.toISOString().slice(0, 10));
        }

        // Build LLM assignment counts per slotKey: "date-role-hour" -> count of staff
        const llmSlotCounts = new Map<string, number>();
        for (const slot of schedule.slots) {
          const date = slot.date ?? slot.slotId.split('-').slice(0, 3).join('-');
          const role = slot.role ?? slot.slotId.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/-\d+$/, '');
          const hour = slot.hour ?? parseInt(slot.slotId.split('-').pop()!, 10);
          const key = `${date}::${role}::${hour}`;
          llmSlotCounts.set(key, (llmSlotCounts.get(key) ?? 0) + 1);
        }

        // Build staff lookup for feasibility checks
        const staffList: any[] = inputData.staff ?? [];
        const parseTimeLocal = (t: string) => { const [hh, mm] = t.split(':').map(Number); return hh + mm / 60; };

        for (const req of coverageReqs) {
          const startH = Math.ceil(parseTime(req.startTime) - 0.001);
          const endH = Math.ceil(parseTime(req.endTime) - 0.001);
          for (const dow of req.days) {
            if (closedDays.includes(dow)) continue;
            const date = dowToDate.get(dow);
            if (!date) continue;
            for (let h = startH; h < endH; h++) {
              // Feasibility check: count eligible staff for this (date, role, hour)
              let eligibleCount = 0;
              for (const s of staffList) {
                if (!s.qualifications || !s.qualifications.includes(req.role)) continue;
                if (Array.isArray(s.availability)) {
                  const avail = s.availability.some((w: any) => {
                    if (w.day !== date) return false;
                    const ws = parseTimeLocal(w.startTime);
                    const we = parseTimeLocal(w.endTime);
                    return ws <= h + 0.001 && we >= h + 1 - 0.001;
                  });
                  if (!avail) continue;
                }
                eligibleCount++;
              }
              // Skip infeasible slots where not enough eligible staff exist
              if (eligibleCount < req.minStaff) continue;

              totalRequiredSlots++;
              const key = `${date}::${req.role}::${h}`;
              const assigned = llmSlotCounts.get(key) ?? 0;
              if (assigned >= req.minStaff) {
                slotsMetMin++;
              } else {
                minStaffViolations.push(`${key}: ${assigned}/${req.minStaff}`);
              }
            }
          }
        }
        minStaffCoverage = totalRequiredSlots > 0 ? slotsMetMin / totalRequiredSlots : 1.0;
      }
    }

    // --- eligibilityCompliance: % of assignments where staff is qualified + available ---
    let eligibilityCompliance = 1.0;
    let totalAssignments = 0;
    let validAssignments = 0;
    const eligViolations: string[] = [];

    if (inputData) {
      const staffList: any[] = inputData.staff ?? [];
      const staffMap = new Map<string, any>();
      for (const s of staffList) staffMap.set(s.id, s);
      const parseTime = (t: string) => { const [hh, mm] = t.split(':').map(Number); return hh + mm / 60; };

      for (const slot of schedule.slots) {
        totalAssignments++;
        const staff = staffMap.get(slot.staffId);
        if (!staff) {
          eligViolations.push(`${slot.staffId}: unknown staff`);
          continue;
        }

        const role = slot.role ?? slot.slotId.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/-\d+$/, '');
        const date = slot.date ?? slot.slotId.split('-').slice(0, 3).join('-');
        const hour = slot.hour ?? parseInt(slot.slotId.split('-').pop()!, 10);

        // Check qualification
        if (staff.qualifications && !staff.qualifications.includes(role)) {
          eligViolations.push(`${slot.staffId}: not qualified for ${role}`);
          continue;
        }

        // Check availability (if explicit availability windows exist, staff must have a covering window)
        if (Array.isArray(staff.availability)) {
          const avail = staff.availability.some((w: any) => {
            if (w.day !== date) return false;
            const ws = parseTime(w.startTime);
            const we = parseTime(w.endTime);
            return ws <= hour + 0.001 && we >= hour + 1 - 0.001;
          });
          if (!avail) {
            eligViolations.push(`${slot.staffId}: not available ${date} h${hour}`);
            continue;
          }
        }

        validAssignments++;
      }
      eligibilityCompliance = totalAssignments > 0 ? validAssignments / totalAssignments : 1.0;
    }

    // --- Pass criteria: universal constraint validation ---
    const pass = hoursCompliance === 1.0
      && minStaffCoverage >= 0.95
      && eligibilityCompliance >= 0.98;

    return {
      pass,
      score: slotRecall,
      namedScores: {
        slotRecall,
        slotPrecision,
        slotExactMatch,
        referenceOverlap,
        staffUtilization,
        coverageCompleteness,
        hoursCompliance,
        ftHoursMin,
        minStaffCoverage,
        eligibilityCompliance,
      },
      reason: `Slot: recall=${slotRecall.toFixed(3)}, precision=${slotPrecision.toFixed(3)}, exactMatch=${slotExactMatch.toFixed(2)}, refOverlap=${referenceOverlap.toFixed(3)}, utilization=${staffUtilization.toFixed(2)}, coverage=${coverageCompleteness.toFixed(2)}, hoursOK=${hoursCompliance}, minStaffCov=${minStaffCoverage.toFixed(3)} (${slotsMetMin}/${totalRequiredSlots}), eligibility=${eligibilityCompliance.toFixed(3)} (${validAssignments}/${totalAssignments}) | ${recallHits}/${goldenPairs.size} slots recalled | ${exactMatches}/${totalSlotHours} slot-hours exact${hourViolations.length > 0 ? ' | HOUR VIOLATIONS: ' + hourViolations.join('; ') : ''}${minStaffViolations.length > 0 ? ' | MIN-STAFF GAPS: ' + minStaffViolations.slice(0, 10).join('; ') + (minStaffViolations.length > 10 ? ` (+${minStaffViolations.length - 10} more)` : '') : ''}${eligViolations.length > 0 ? ' | ELIG VIOLATIONS: ' + eligViolations.slice(0, 10).join('; ') + (eligViolations.length > 10 ? ` (+${eligViolations.length - 10} more)` : '') : ''}`,
    };
  } catch (e) {
    return {
      pass: false,
      score: 0,
      reason: `Failed to score slots: ${e instanceof Error ? e.message : 'unknown error'}`,
    };
  }
}
