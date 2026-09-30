const fs = require('fs');
const path = require('path');

// Time-range availability helpers (mirrors lib/scheduling/validator.ts)
function parseTimeToHours(time) {
  const [h, m] = time.split(':').map(Number);
  return h + m / 60;
}

function isAvailableForShift(s, shift, minShiftHours) {
  minShiftHours = minShiftHours || 3;
  if (!s.availability || s.availability.length === 0) {
    return !s.unavailable.includes(shift.id);
  }
  const windows = s.availability.filter(w => w.day === shift.date);
  if (windows.length === 0) return false;
  let totalOverlap = 0;
  for (const w of windows) {
    const overlapStart = Math.max(parseTimeToHours(w.startTime), parseTimeToHours(shift.startTime));
    const overlapEnd = Math.min(parseTimeToHours(w.endTime), parseTimeToHours(shift.endTime));
    totalOverlap += Math.max(0, overlapEnd - overlapStart);
  }
  return totalOverlap >= minShiftHours;
}

function isWeekend(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

function formatHours(h) {
  return Number.isInteger(h) ? h + 'h' : h.toFixed(1) + 'h';
}

function timeFromHours(h) {
  const hours = Math.floor(h);
  const minutes = Math.round((h - hours) * 60);
  return String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0');
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
  const minShiftHours = data.businessConfig?.minShiftHours || 3;
  const bc = data.businessConfig;
  const pr = data.preferenceRules || [];
  const ftHours = bc?.fullTimeHours;

  // Compute duration of each shift in hours (accounting for breaks)
  const shiftDuration = {};
  for (const shift of shifts) {
    const [sh, sm] = shift.startTime.split(':').map(Number);
    const [eh, em] = shift.endTime.split(':').map(Number);
    let hours = (eh * 60 + em - sh * 60 - sm) / 60;
    if (shift.breakMinutes) {
      hours -= shift.breakMinutes / 60;
    }
    shiftDuration[shift.id] = hours;
  }

  const guide = shifts.map(shift => {
    const eligible = staff
      .filter(s => s.qualifications.includes(shift.requiredRole))
      .filter(s => isAvailableForShift(s, shift, minShiftHours))
      .map(s => s.id);
    const slack = eligible.length - shift.minStaff;
    return { id: shift.id, role: shift.requiredRole, min: shift.minStaff, eligible, slack };
  }).sort((a, b) => a.slack - b.slack);

  const infeasibleShifts = [];

  const lines = guide.map(g => {
    if (g.slack === 0) {
      return g.id + ' (' + g.role + ', min ' + g.min + '): [' + g.eligible.join(', ') + '] ** FORCED **';
    } else if (g.slack < 0) {
      infeasibleShifts.push(g);
      return g.id + ' (' + g.role + ', min ' + g.min + ', only ' + g.eligible.length + ' eligible): [' + g.eligible.join(', ') + '] !! INFEASIBLE (min ' + g.min + ', only ' + g.eligible.length + ' eligible) — assign all eligible !!';
    } else {
      return g.id + ' (' + g.role + ', min ' + g.min + ', ' + g.eligible.length + ' eligible): [' + g.eligible.join(', ') + '] — assign ' + g.min + '+ from this list';
    }
  });

  // Add INFEASIBLE summary if any
  if (infeasibleShifts.length > 0) {
    lines.push('');
    lines.push('INFEASIBLE SHIFTS SUMMARY — assign ALL eligible staff to these:');
    for (const g of infeasibleShifts) {
      lines.push('  ' + g.id + ': min ' + g.min + ', only ' + g.eligible.length + ' eligible → assign [' + g.eligible.join(', ') + ']');
    }
  }

  const eligibility_guide = lines.join('\n');

  // --- Staffing plan: hour budgets + pre-solved assignments ---

  // Build per-staff eligible shift list and total available hours
  const staffEligibility = {};
  for (const s of staff) {
    staffEligibility[s.id] = { shifts: [], totalAvailableHours: 0 };
  }
  for (const g of guide) {
    for (const sid of g.eligible) {
      staffEligibility[sid].shifts.push(g.id);
      staffEligibility[sid].totalAvailableHours += shiftDuration[g.id] || 0;
    }
  }

  // Availability summary per staff
  const availabilitySummary = staff.map(s => {
    if (s.availability && s.availability.length > 0) {
      const dayNames = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };
      const windows = s.availability.map(w => {
        const d = new Date(w.day + 'T00:00:00Z');
        const dayName = dayNames[d.getUTCDay()] || w.day;
        return dayName + ' ' + w.startTime + '-' + w.endTime;
      }).join(', ');
      return '  ' + s.id + ' (' + (s.qualifications || []).join('/') + ', ' + (s.level || '?') + ', ' + (s.employmentType || 'part-time') + ', max ' + s.maxWeeklyHours + 'h): ' + windows;
    }
    return null;
  }).filter(Boolean);

  // Detect forced hours per staff
  const forcedHoursPerStaff = {};
  for (const g of guide) {
    if (g.slack <= 0) {
      for (const sid of g.eligible) {
        if (!forcedHoursPerStaff[sid]) forcedHoursPerStaff[sid] = { shifts: [], totalHours: 0 };
        forcedHoursPerStaff[sid].shifts.push(g.id);
        forcedHoursPerStaff[sid].totalHours += shiftDuration[g.id] || 0;
      }
    }
  }

  // Hour budget lines with remaining hours
  const budgetLines = staff.map(s => {
    const type = s.employmentType === 'full-time' ? 'full-time' : 'part-time';
    const maxH = s.maxWeeklyHours;
    const hardMax = (type === 'full-time' && ftHours) ? ftHours.max : maxH;
    const eligShifts = staffEligibility[s.id].shifts;
    const availH = staffEligibility[s.id].totalAvailableHours;
    const forced = forcedHoursPerStaff[s.id];
    const forcedH = forced ? forced.totalHours : 0;
    const forcedCount = forced ? forced.shifts.length : 0;
    const remainingH = Math.max(0, hardMax - forcedH);
    const optionalCount = eligShifts.length - forcedCount;
    const warning = (availH > hardMax) ? ' ⚠ OVER LIMIT — must use shortened shifts' : '';

    let line = '  ' + s.id + ': ' + type + ', max ' + maxH + 'h';
    if (type === 'full-time' && ftHours) line += ' (hard ceiling ' + hardMax + 'h)';
    if (forcedH > 0) {
      line += ', forced ' + formatHours(forcedH) + ' across ' + forcedCount + ' shifts';
      line += ', remaining ' + formatHours(remainingH) + ' for ' + optionalCount + ' optional shift' + (optionalCount !== 1 ? 's' : '');
    } else {
      line += ', ' + formatHours(availH) + ' across ' + eligShifts.length + ' eligible shifts: [' + eligShifts.join(', ') + ']';
    }
    line += warning;
    return line;
  });

  const overcommittedStaff = {};
  for (const s of staff) {
    const forced = forcedHoursPerStaff[s.id];
    if (!forced) continue;
    const type = s.employmentType === 'full-time' ? 'full-time' : 'part-time';
    const hardMax = (type === 'full-time' && ftHours) ? ftHours.max : s.maxWeeklyHours;
    if (forced.totalHours > hardMax) {
      overcommittedStaff[s.id] = { hardMax, forcedHours: forced.totalHours, shifts: forced.shifts };
    }
  }

  // Pre-solved assignments
  const preSolvedLines = [];
  const remainingLines = [];
  for (const g of guide) {
    if (g.slack === 0) {
      const sole = g.eligible[0];
      if (g.eligible.length === 1 && overcommittedStaff[sole]) {
        const oc = overcommittedStaff[sole];
        preSolvedLines.push('  FORCED (but hours-limited): ' + g.id + ' → [' + sole + '] — ' + sole + ' has ' + formatHours(oc.forcedHours) + ' across ' + oc.shifts.length + ' forced shifts but max ' + oc.hardMax + 'h. Assign with shortened hours or leave unfilled if hours exhausted.');
      } else {
        preSolvedLines.push('  FORCED: ' + g.id + ' → [' + g.eligible.join(', ') + '] (exactly ' + g.min + ' eligible = ' + g.min + ' needed)');
      }
    } else if (g.slack < 0) {
      preSolvedLines.push('  INFEASIBLE: ' + g.id + ' → [' + g.eligible.join(', ') + '] (need ' + g.min + ', only ' + g.eligible.length + ' eligible — assign all)');
    } else {
      remainingLines.push('  ' + g.id + ' (min ' + g.min + ', ' + g.eligible.length + ' eligible): [' + g.eligible.join(', ') + '] — pick ' + g.min + '+ considering hour budgets');
    }
  }

  // Identify staff with very few eligible shifts
  const mustAssignLines = [];
  for (const s of staff) {
    if (overcommittedStaff[s.id]) continue;
    const elig = staffEligibility[s.id];
    if (elig.shifts.length === 1) {
      mustAssignLines.push('  ' + s.id + ': only eligible for ' + elig.shifts[0] + ' — MUST assign');
    } else if (elig.shifts.length === 2) {
      mustAssignLines.push('  ' + s.id + ': only eligible for [' + elig.shifts.join(', ') + '] — assign to both if hours allow');
    }
  }

  const staffing_plan_parts = ['STAFF HOUR BUDGETS:'];
  staffing_plan_parts.push(...budgetLines);
  if (mustAssignLines.length > 0) {
    staffing_plan_parts.push('');
    staffing_plan_parts.push('MUST-ASSIGN STAFF (very few eligible shifts — prioritize these):');
    staffing_plan_parts.push(...mustAssignLines);
  }
  if (preSolvedLines.length > 0) {
    staffing_plan_parts.push('');
    staffing_plan_parts.push('PRE-SOLVED ASSIGNMENTS (copy these directly into output):');
    staffing_plan_parts.push(...preSolvedLines);
  }
  if (remainingLines.length > 0) {
    staffing_plan_parts.push('');
    staffing_plan_parts.push('REMAINING SHIFTS TO SOLVE:');
    staffing_plan_parts.push(...remainingLines);
  }
  const staffing_plan = staffing_plan_parts.join('\n');

  // Extract scheduling parameters from businessConfig
  let scheduling_params = '';
  if (bc) {
    const parts = [];
    if (bc.breakRules) {
      const breaks = bc.breakRules.map(b =>
        `${b.name}: ${b.durationMinutes}min`
      ).join('; ');
      const deductInfo = bc.breakDeduction && bc.breakDeduction.enabled
        ? ` (deducted from hours for ${bc.breakDeduction.appliesTo === 'both' ? 'all staff' : bc.breakDeduction.appliesTo + ' staff'})`
        : ' (paid, not deducted)';
      parts.push(`Break rules: ${breaks}${deductInfo}`);
    }
    if (bc.fullTimeHours) {
      parts.push(`Full-time hours: TARGET ${bc.fullTimeHours.target}h/week (no overtime), HARD MAX ${bc.fullTimeHours.max}h. NOTE: maxWeeklyHours = target, not hard ceiling.`);
    }
    if (bc.roleMinimumsPerShift) {
      const mins = bc.roleMinimumsPerShift.map(r => `at least ${r.min} ${r.role} per shift`).join('; ');
      parts.push(`Role minimums: ${mins}`);
    }
    if (bc.maxConsecutiveDays) {
      parts.push(`Maximum consecutive working days: ${bc.maxConsecutiveDays}`);
    }
    if (bc.closedDays) {
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const closed = bc.closedDays.map(d => dayNames[d] || d).join(', ');
      parts.push(`Closed: ${closed}`);
    }
    if (bc.weights) {
      const w = bc.weights;
      parts.push(`Optimisation weights: cost=${w.cost}, fairness=${w.fairness}, preference=${w.preference}`);
    }
    parts.push('minStaff: minimum required per shift (floor, not ceiling). Assign more eligible staff when they have remaining hours.');
    scheduling_params = parts.join('\n');
  }

  // Extract business rules from preferenceRules
  // Hard rules AND kitchen-hours-type rules go into scheduling_params
  const hardRules = pr.filter(r => r.ruleType === 'hard');
  const softRules = pr.filter(r => r.ruleType !== 'hard');

  let business_rules = '';
  if (hardRules.length > 0) {
    scheduling_params += '\n\nHARD CONSTRAINTS (from business rules — must be enforced):';
    for (const r of hardRules) {
      scheduling_params += '\n- ' + r.ruleText;
    }
  }
  if (softRules.length > 0) {
    business_rules = softRules.map(r => `PREFER: ${r.ruleText}`).join('\n');
  }

  // Staff availability guide (time-range format)
  let staff_availability = '';
  if (availabilitySummary.length > 0) {
    staff_availability = 'STAFF AVAILABILITY (when each person CAN work):\n' + availabilitySummary.join('\n');
  }

  // Build dynamic hours tracking from break rules
  let hours_tracking = 'HOURS TRACKING:';
  if (bc && bc.breakRules && bc.breakRules.length > 0) {
    var deductEnabled = bc.breakDeduction && bc.breakDeduction.enabled;
    var totalBreakMin = bc.breakRules.reduce(function(sum, b) { return sum + b.durationMinutes; }, 0);
    var breakDesc = bc.breakRules
      .map(function(b) { return b.name + ' ' + b.durationMinutes + 'min'; })
      .join(' + ');
    if (totalBreakMin > 0 && deductEnabled) {
      hours_tracking += '\n- Shifts with breaks have ' + breakDesc + ' (' + totalBreakMin + 'min total) deducted — net hours = (endTime - startTime - ' + (totalBreakMin / 60) + 'h)';
    }
  }
  hours_tracking += '\n- Track NET hours (after break deduction) against maxWeeklyHours limits';

  // Generate constraint_tiers dynamically from businessConfig
  const tierLines = ['CONSTRAINT TIERS:', 'CRITICAL (never violate — automatic failure):'];
  tierLines.push('- Staff can only be assigned roles they are qualified for');
  tierLines.push('- Staff can only be scheduled during their available hours');
  if (bc && bc.minRestHoursBetweenShifts) {
    tierLines.push('- Minimum ' + bc.minRestHoursBetweenShifts + 'h rest between shifts');
  }
  if (bc && bc.maxConsecutiveDays) {
    tierLines.push('- Maximum ' + bc.maxConsecutiveDays + ' consecutive working days');
  }
  tierLines.push('- Part-time staff must not exceed their maxWeeklyHours');
  if (ftHours) {
    tierLines.push('- Full-time staff must not exceed ' + ftHours.max + 'h/week (hard ceiling)');
  }
  tierLines.push('- Every FEASIBLE shift must be staffed to AT LEAST minStaff — assign additional eligible staff when they have remaining hour capacity');
  const constraint_tiers = tierLines.join('\n');

  // Generate soft_goals dynamically from preferenceRules + weights
  const goalLines = [];

  // Priority order from weights
  const weightEntries = bc && bc.weights ? Object.entries(bc.weights).sort((a, b) => b[1] - a[1]) : [];
  const priorityOrder = ['PRIORITY ORDER (when goals conflict):'];
  priorityOrder.push('1. Coverage — every feasible shift staffed to minStaff+');
  priorityOrder.push('2. Hour limits — never exceed hard ceilings');
  priorityOrder.push('3. Full-time targets — schedule close to maxWeeklyHours');
  let priorityNum = 4;
  for (const [key, val] of weightEntries) {
    if (key === 'fairness' && val > 0) {
      priorityOrder.push(priorityNum + '. Fairness (weight ' + val + ') — every available staff member gets shifts');
      priorityNum++;
    } else if (key === 'cost' && val > 0) {
      priorityOrder.push(priorityNum + '. Cost (weight ' + val + ') — minimize total labor cost');
      priorityNum++;
    } else if (key === 'preference' && val > 0) {
      priorityOrder.push(priorityNum + '. Preference (weight ' + val + ') — maximize preference adherence');
      priorityNum++;
    }
  }

  goalLines.push(...priorityOrder);
  goalLines.push('');
  goalLines.push('SOFT GOALS (optimise but don\'t sacrifice critical constraints):');

  // Add soft rules from preferenceRules
  for (const r of softRules) {
    goalLines.push('- ' + r.ruleText);
  }

  // Add generic goals parameterized by weights
  if (!softRules.some(r => /fair/i.test(r.ruleText))) {
    goalLines.push('- Distribute hours fairly across staff');
  }
  if (!softRules.some(r => /cost/i.test(r.ruleText))) {
    goalLines.push('- Minimize total labor cost while meeting all constraints');
  }

  const soft_goals = goalLines.join('\n');

  return { ...vars, input: raw, eligibility_guide, staffing_plan, scheduling_params, business_rules, staff_availability, hours_tracking, constraint_tiers, soft_goals };
};
