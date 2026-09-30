/**
 * Slot-based input transform for promptfoo evals.
 *
 * Variant of compute-eligibility.js that converts shift-window input to
 * slot-based input (1hr granularity) before passing to the LLM.
 *
 * Each shift is exploded into hourly slots with per-slot eligibility.
 * The LLM is expected to output slot-level assignments directly.
 */

const fs = require('fs');
const path = require('path');

const DAY_ABBREVS = { 0: 'sun', 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat' };

function getDayAbbrev(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  return DAY_ABBREVS[d.getUTCDay()];
}

function parseTimeToHours(time) {
  const [h, m] = time.split(':').map(Number);
  return h + m / 60;
}

function formatHours(h) {
  return Number.isInteger(h) ? h + 'h' : h.toFixed(1) + 'h';
}

function isWeekend(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Check if a staff member is available at a specific hour on a specific date.
 */
function isAvailableAtHour(staff, date, hour) {
  if (!staff.availability || staff.availability.length === 0) {
    return false;
  }
  const windows = staff.availability.filter(function (w) { return w.day === date; });
  for (const w of windows) {
    const wStart = parseTimeToHours(w.startTime);
    const wEnd = parseTimeToHours(w.endTime);
    // Staff covers hour H if their window includes [H, H+1)
    // i.e. wStart <= H and wEnd >= H+1
    if (wStart <= hour + 0.001 && wEnd >= hour + 1 - 0.001) {
      return true;
    }
  }
  return false;
}

module.exports = function (vars) {
  let raw;
  if (typeof vars.input === 'string' && vars.input.startsWith('file://')) {
    const evalsDir = path.resolve(process.cwd(), 'evals');
    const filePath = path.resolve(evalsDir, vars.input.slice('file://'.length));
    raw = fs.readFileSync(filePath, 'utf-8');
  } else if (typeof vars.input === 'string') {
    raw = vars.input;
  } else {
    raw = JSON.stringify(vars.input);
  }

  const data = JSON.parse(raw);
  const shifts = data.shifts || [];
  const staff = data.staff || [];
  const bc = data.businessConfig;
  const pr = data.preferenceRules || [];
  const ftHours = bc?.fullTimeHours;
  // Explode shifts into hourly slots with eligibility
  const allSlots = [];
  const slotEligibility = {}; // slotId → { eligible: [], role, minStaff, date, hour }

  for (const shift of shifts) {
    const startH = parseTimeToHours(shift.startTime);
    const endH = parseTimeToHours(shift.endTime);
    const dayAbbrev = getDayAbbrev(shift.date);
    const role = shift.requiredRole;

    const firstHour = Math.ceil(startH - 0.001);
    const lastHour = Math.ceil(endH - 0.001) - 1;

    for (let h = firstHour; h <= lastHour; h++) {
      const slotId = dayAbbrev + '-' + role + '-' + h;

      // Find eligible staff for this slot-hour
      const eligible = staff
        .filter(function (s) { return s.qualifications.includes(role); })
        .filter(function (s) { return isAvailableAtHour(s, shift.date, h); })
        .map(function (s) { return s.id; });

      allSlots.push({
        slotId: slotId,
        date: shift.date,
        hour: h,
        role: role,
        minStaff: shift.minStaff,
        eligible: eligible,
        sourceShift: shift.id,
      });

      slotEligibility[slotId] = { eligible: eligible, role: role, minStaff: shift.minStaff, date: shift.date, hour: h };
    }
  }

  // Sort slots by date, hour
  allSlots.sort(function (a, b) {
    return a.date.localeCompare(b.date) || a.hour - b.hour || a.role.localeCompare(b.role);
  });

  // Pre-compute staff hours, break deductions, and FT slot targets (needed for effective min)
  const staffHoursMap = {};
  for (const s of staff) {
    staffHoursMap[s.id] = { eligibleSlots: 0, type: s.employmentType, maxH: s.maxWeeklyHours };
  }
  for (const slot of allSlots) {
    for (const sid of slot.eligible) {
      if (staffHoursMap[sid]) staffHoursMap[sid].eligibleSlots++;
    }
  }

  var breakDeductMinutes = (bc && bc.breakRules)
    ? bc.breakRules.reduce(function (sum, b) { return sum + b.durationMinutes; }, 0)
    : 0;
  var breakDeductHours = breakDeductMinutes / 60;
  var breakDeductionEnabled = bc && bc.breakDeduction && bc.breakDeduction.enabled;
  var breakAppliesTo = (bc && bc.breakDeduction && bc.breakDeduction.appliesTo) || 'both';
  function shouldDeductBreaksFor(s) {
    if (!breakDeductionEnabled) return false;
    if (breakAppliesTo === 'both') return true;
    if (breakAppliesTo === 'full-time') return s.employmentType === 'full-time';
    if (breakAppliesTo === 'part-time') return s.employmentType === 'part-time';
    return false;
  }

  var staffEligDays = {};
  for (const s of staff) {
    var daySet = {};
    for (const slot of allSlots) {
      if (slot.eligible.indexOf(s.id) === -1) continue;
      if (!daySet[slot.date]) daySet[slot.date] = 0;
      daySet[slot.date] += 1;
    }
    var days = Object.keys(daySet);
    var netHours = 0;
    var deductForThisStaff = shouldDeductBreaksFor(s);
    for (var di = 0; di < days.length; di++) {
      netHours += deductForThisStaff ? daySet[days[di]] - breakDeductHours : daySet[days[di]];
    }
    staffEligDays[s.id] = { dayGross: daySet, days: days, netHours: netHours };
  }

  var ftSlotTargets = {};
  for (const s of staff) {
    if (s.employmentType !== 'full-time' || !ftHours) continue;
    var eligInfo = staffEligDays[s.id];
    var numDays = eligInfo.days.length;
    if (numDays === 0) continue;
    var totalEligSlots = 0;
    for (var di = 0; di < eligInfo.days.length; di++) {
      totalEligSlots += eligInfo.dayGross[eligInfo.days[di]];
    }
    var ftBreakDeduct = shouldDeductBreaksFor(s) ? breakDeductHours : 0;
    var targetGross = Math.min(ftHours.target + ftBreakDeduct * numDays, totalEligSlots);
    var minGross = Math.min(ftHours.min + ftBreakDeduct * numDays, totalEligSlots);
    var maxGross = Math.min(ftHours.max + ftBreakDeduct * numDays, totalEligSlots);
    var slotsPerDay = Math.round(targetGross / numDays);
    ftSlotTargets[s.id] = { targetGross: targetGross, minGross: minGross, maxGross: maxGross, slotsPerDay: slotsPerDay, eligDays: numDays, totalEligSlots: totalEligSlots };
  }

  // Build eligibility guide (slot-based)
  const eligLines = allSlots.map(function (slot) {
    const slack = slot.eligible.length - slot.minStaff;

    // Compute effective min for FT-only slots
    var effectiveMin = slot.minStaff;
    var allFT = slot.eligible.length > 0 && slot.eligible.every(function (sid) {
      return staff.find(function (s) { return s.id === sid; }).employmentType === 'full-time';
    });
    if (allFT && Object.keys(ftSlotTargets).length > 0) {
      var highNeedCount = 0;
      for (var ei = 0; ei < slot.eligible.length; ei++) {
        var ft = ftSlotTargets[slot.eligible[ei]];
        if (ft && ft.totalEligSlots > 0 && ft.targetGross / ft.totalEligSlots >= 0.85) {
          highNeedCount++;
        }
      }
      effectiveMin = Math.max(slot.minStaff, highNeedCount);
    }

    var minLabel = effectiveMin > slot.minStaff
      ? 'min ' + slot.minStaff + '→' + effectiveMin + ' for FT targets'
      : 'min ' + slot.minStaff;

    // Compute a common slotsPerDay hint for FT annotations
    var ftSlotsPerDayHint = Infinity;
    if (effectiveMin > slot.minStaff) {
      for (var fi = 0; fi < slot.eligible.length; fi++) {
        var ftInfo = ftSlotTargets[slot.eligible[fi]];
        if (ftInfo) ftSlotsPerDayHint = Math.min(ftSlotsPerDayHint, ftInfo.slotsPerDay);
      }
    }
    if (ftSlotsPerDayHint === Infinity) ftSlotsPerDayHint = null;

    if (slack === 0) {
      return slot.slotId + ' (' + slot.role + ', ' + minLabel + '): [' + slot.eligible.join(', ') + '] ** FORCED **';
    } else if (slack < 0) {
      return slot.slotId + ' (' + slot.role + ', ' + minLabel + ', only ' + slot.eligible.length + ' eligible): [' + slot.eligible.join(', ') + '] !! INFEASIBLE !!';
    } else if (effectiveMin >= slot.eligible.length && ftSlotsPerDayHint) {
      return slot.slotId + ' (' + slot.role + ', ' + minLabel + '): [' + slot.eligible.join(', ') + '] — FT PRIORITY: assign both (trim to ~' + ftSlotsPerDayHint + ' slots/day per FULL-TIME STAFF targets)';
    } else if (effectiveMin > slot.minStaff) {
      return slot.slotId + ' (' + slot.role + ', ' + minLabel + '): [' + slot.eligible.join(', ') + '] — assign at least ' + effectiveMin + ', FT staff need these slots';
    } else {
      return slot.slotId + ' (' + slot.role + ', ' + minLabel + ', ' + slot.eligible.length + ' eligible): [' + slot.eligible.join(', ') + ']';
    }
  });
  const eligibility_guide = eligLines.join('\n');

  // Build staffing plan with hour budgets
  const budgetLines = staff.map(function (s) {
    const info = staffHoursMap[s.id];
    const type = s.employmentType === 'full-time' ? 'full-time' : 'part-time';

    if (type === 'full-time' && ftHours && ftSlotTargets[s.id]) {
      var ft = ftSlotTargets[s.id];
      var totalBreakH = breakDeductHours * ft.eligDays;
      return '  ' + s.id + ': full-time ' + (s.qualifications || []).join('/') + ', TARGET ' + ft.targetGross + ' gross slots (' + ftHours.target + 'h net + ' + totalBreakH + 'h breaks), min ' + ft.minGross + ', max ' + ft.maxGross;
    } else if (type === 'full-time' && ftHours) {
      return '  ' + s.id + ': full-time, 0 eligible days (on leave)';
    }
    return '  ' + s.id + ': ' + type + ', max ' + s.maxWeeklyHours + 'h' +
      ', eligible for ' + info.eligibleSlots + ' slot-hours';
  });

  // Full-time staff scheduling section with slot targets
  var ftScheduleLines = [];
  for (const s of staff) {
    if (s.employmentType !== 'full-time' || !ftHours) continue;
    var ft = ftSlotTargets[s.id];
    if (!ft || ft.eligDays === 0) continue;
    var roles = (s.qualifications || []).join('/');
    var totalBreakH = breakDeductHours * ft.eligDays;
    var rawPerDay = ft.targetGross / ft.eligDays;
    var roundDir = (rawPerDay % 1) >= 0.5 ? 'up' : 'down';
    ftScheduleLines.push('  ' + s.id + ': ' + roles + ', ' + ft.eligDays + ' eligible days, ' + ft.totalEligSlots + ' eligible slots');
    ftScheduleLines.push('    Net hours: TARGET ' + ftHours.target + 'h (min ' + ftHours.min + 'h, max ' + ftHours.max + 'h)');
    ftScheduleLines.push('    Break deduction: ' + breakDeductHours + 'h/day x ' + ft.eligDays + ' days = ' + totalBreakH + 'h');
    ftScheduleLines.push('    Gross slots needed: TARGET ' + ft.targetGross + ' (min ' + ft.minGross + ', max ' + ft.maxGross + ')');
    ftScheduleLines.push('    Per day: ~' + ft.slotsPerDay + ' slots/day (' + ft.targetGross + '/' + ft.eligDays + '=' + rawPerDay.toFixed(1) + ' → round ' + roundDir + ')');
  }

  var staffPlanParts = ['STAFF HOUR BUDGETS (each slot = 1 hour):'];
  staffPlanParts.push.apply(staffPlanParts, budgetLines);
  if (ftScheduleLines.length > 0) {
    staffPlanParts.push('');
    staffPlanParts.push('FULL-TIME STAFF (schedule these first — assign target slots as continuous blocks each day):');
    staffPlanParts.push.apply(staffPlanParts, ftScheduleLines);
  }
  const staffing_plan = staffPlanParts.join('\n');

  // Scheduling parameters (reuse logic from compute-eligibility.js)
  let scheduling_params = '';
  if (bc) {
    const parts = [];
    if (bc.breakRules) {
      const breaks = bc.breakRules.map(function (b) {
        return b.name + ': ' + b.durationMinutes + 'min';
      }).join('; ');
      var deductNote = breakDeductionEnabled
        ? ' (deducted from hours for ' + (breakAppliesTo === 'both' ? 'all staff' : breakAppliesTo + ' staff') + ')'
        : ' (paid, not deducted)';
      parts.push('Break rules: ' + breaks + deductNote);
    }
    if (bc.fullTimeHours) {
      parts.push('Full-time hours: MINIMUM ' + bc.fullTimeHours.min + 'h/week, TARGET ' + bc.fullTimeHours.target + 'h/week, HARD MAX ' + bc.fullTimeHours.max + 'h');
    }
    if (bc.maxConsecutiveDays) {
      parts.push('Maximum consecutive working days: ' + bc.maxConsecutiveDays);
    }
    if (bc.closedDays) {
      var dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      var closed = bc.closedDays.map(function (d) { return dayNames[d] || d; }).join(', ');
      parts.push('Closed: ' + closed);
    }
    parts.push('Each slot = 1 hour of coverage. Assign staff to individual slot-hours.');
    scheduling_params = parts.join('\n');
  }

  // Hard constraint rules
  const hardRules = pr.filter(function (r) { return r.ruleType === 'hard'; });
  const softRules = pr.filter(function (r) { return r.ruleType !== 'hard'; });

  if (hardRules.length > 0) {
    scheduling_params += '\n\nHARD CONSTRAINTS:';
    for (const r of hardRules) {
      scheduling_params += '\n- ' + r.ruleText;
    }
  }

  let business_rules = '';
  if (softRules.length > 0) {
    business_rules = softRules.map(function (r) { return 'PREFER: ' + r.ruleText; }).join('\n');
  }

  // Staff availability
  const dayNameMap = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };
  const availLines = staff.map(function (s) {
    if (s.availability && s.availability.length > 0) {
      const windows = s.availability.map(function (w) {
        var d = new Date(w.day + 'T00:00:00Z');
        var dn = dayNameMap[d.getUTCDay()] || w.day;
        return dn + ' ' + w.startTime + '-' + w.endTime;
      }).join(', ');
      return '  ' + s.id + ' (' + (s.qualifications || []).join('/') + ', ' + (s.level || '?') + ', max ' + s.maxWeeklyHours + 'h): ' + windows;
    }
    return null;
  }).filter(Boolean);

  // Add lines for staff with empty availability
  for (const s of staff) {
    if (!s.availability || s.availability.length === 0) {
      availLines.push('  ' + s.id + ' (' + (s.qualifications || []).join('/') + ', ' + (s.level || '?') + ', max ' + s.maxWeeklyHours + 'h): no availability this week');
    }
  }

  let staff_availability = '';
  if (availLines.length > 0) {
    staff_availability = 'STAFF AVAILABILITY:\n' + availLines.join('\n');
  }

  // Hours tracking
  let hours_tracking = 'HOURS TRACKING:\n- Each slot assignment = 1 hour of work';
  if (bc && bc.breakRules) {
    var totalBreakMin = bc.breakRules.reduce(function (sum, b) { return sum + b.durationMinutes; }, 0);
    if (totalBreakMin > 0 && breakDeductionEnabled) {
      hours_tracking += '\n- Break deductions apply to shifts spanning multiple hours — accounted for in slot eligibility';
    }
  }
  hours_tracking += '\n- Track total assigned slots against maxWeeklyHours';

  // Constraint tiers
  const tierLines = ['CONSTRAINT TIERS:', 'CRITICAL (never violate):'];
  tierLines.push('- Only assign staff to slots where they appear in the eligible list');
  tierLines.push('- Part-time staff must not exceed maxWeeklyHours in total slot assignments');
  if (ftHours) {
    tierLines.push('- Full-time staff must not exceed ' + ftHours.max + ' total slot assignments');
    tierLines.push('- Full-time staff must be scheduled for at least ' + ftHours.min + 'h/week (after break deductions)');
  }
  tierLines.push('- Every slot with eligible staff must have at least minStaff assigned');
  const constraint_tiers = tierLines.join('\n');

  // Soft goals
  const goalLines = ['SOFT GOALS:'];
  for (const r of softRules) {
    goalLines.push('- ' + r.ruleText);
  }
  goalLines.push('- Distribute slot assignments fairly across staff');
  goalLines.push('- Minimize total labor cost');
  const soft_goals = goalLines.join('\n');

  return {
    ...vars,
    input: raw,
    eligibility_guide: eligibility_guide,
    staffing_plan: staffing_plan,
    scheduling_params: scheduling_params,
    business_rules: business_rules,
    staff_availability: staff_availability,
    hours_tracking: hours_tracking,
    constraint_tiers: constraint_tiers,
    soft_goals: soft_goals,
  };
};
