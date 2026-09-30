/**
 * Compressed slot-based input transform for promptfoo evals.
 *
 * Explodes shifts into hourly slots, computes per-slot eligibility, then
 * groups consecutive same-day, same-role slots with identical eligible sets
 * and minStaff into compressed ranges. This removes shift-boundary anchoring
 * while keeping input compact (~23 lines vs 122 individual slots).
 *
 * LLM outputs slot-level assignments (slotId = {day}-{role}-{hour}).
 */

const fs = require('fs');
const path = require('path');

const DAY_ABBREVS = { 0: 'sun', 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat' };
const DAY_ORDER = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

function getDayAbbrev(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  return DAY_ABBREVS[d.getUTCDay()];
}

function parseTimeToHours(time) {
  const [h, m] = time.split(':').map(Number);
  return h + m / 60;
}

function formatHour(h) {
  return String(h).padStart(2, '0') + ':00';
}

function formatHourRange(startHour, endHour) {
  if (endHour - startHour === 1) return 'h' + startHour;
  return 'h' + startHour + '-h' + (endHour - 1);
}

function isAvailableAtHour(staff, date, hour) {
  if (!staff.availability || staff.availability.length === 0) {
    return false;
  }
  const windows = staff.availability.filter(function (w) { return w.day === date; });
  for (const w of windows) {
    const wStart = parseTimeToHours(w.startTime);
    const wEnd = parseTimeToHours(w.endTime);
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
  var variationType = vars.variationType || 'balanced';
  const staff = data.staff || [];
  const bc = data.businessConfig;
  const pr = data.preferenceRules || [];
  const ftHours = bc?.fullTimeHours;
  const minShiftHours = bc?.minShiftHours || 3;

  // Derive shifts from coverageRequirements + weekStart (or fall back to hardcoded shifts)
  var shifts;
  if (bc && bc.coverageRequirements && data.weekStart) {
    shifts = [];
    var ws = new Date(data.weekStart + 'T00:00:00Z');
    for (var di = 0; di < 7; di++) {
      var d = new Date(ws.getTime() + di * 86400000);
      var dayOfWeek = d.getUTCDay();
      if (bc.closedDays && bc.closedDays.indexOf(dayOfWeek) !== -1) continue;
      var dateStr = d.toISOString().slice(0, 10);
      for (var ci = 0; ci < bc.coverageRequirements.length; ci++) {
        var req = bc.coverageRequirements[ci];
        if (req.days.indexOf(dayOfWeek) === -1) continue;
        shifts.push({
          id: dateStr + '-' + req.role + '-' + req.startTime,
          date: dateStr,
          startTime: req.startTime,
          endTime: req.endTime,
          requiredRole: req.role,
          minStaff: req.minStaff,
          maxStaff: req.maxStaff || null,
        });
      }
    }
  } else {
    shifts = data.shifts || [];
  }

  // Step 1: Explode shifts into hourly slots with eligibility
  const allSlots = [];

  for (const shift of shifts) {
    const startH = parseTimeToHours(shift.startTime);
    const endH = parseTimeToHours(shift.endTime);
    const dayAbbrev = getDayAbbrev(shift.date);
    const role = shift.requiredRole;

    const firstHour = Math.ceil(startH - 0.001);
    const lastHour = Math.ceil(endH - 0.001) - 1;

    for (let h = firstHour; h <= lastHour; h++) {
      const eligible = staff
        .filter(function (s) { return s.qualifications.includes(role); })
        .filter(function (s) { return isAvailableAtHour(s, shift.date, h); })
        .map(function (s) { return s.id; });

      allSlots.push({
        day: dayAbbrev,
        date: shift.date,
        hour: h,
        role: role,
        minStaff: shift.minStaff,
        maxStaff: shift.maxStaff,
        eligible: eligible,
      });
    }
  }

  // Step 2: Sort by day order, role, hour
  allSlots.sort(function (a, b) {
    return (DAY_ORDER[a.day] - DAY_ORDER[b.day]) ||
      a.role.localeCompare(b.role) ||
      (a.hour - b.hour);
  });

  // Step 3: Deduplicate slots (multiple shifts may produce same day-role-hour)
  const seen = {};
  const uniqueSlots = [];
  for (const slot of allSlots) {
    const key = slot.day + '-' + slot.role + '-' + slot.hour;
    if (!seen[key]) {
      seen[key] = true;
      uniqueSlots.push(slot);
    }
  }

  // Per-staff eligibility from individual slots
  const staffEligibility = {};
  for (const s of staff) {
    staffEligibility[s.id] = { totalSlotHours: 0, daySlots: {} };
  }
  for (const slot of uniqueSlots) {
    for (const sid of slot.eligible) {
      if (staffEligibility[sid]) {
        staffEligibility[sid].totalSlotHours++;
        if (!staffEligibility[sid].daySlots[slot.date]) staffEligibility[sid].daySlots[slot.date] = [];
        staffEligibility[sid].daySlots[slot.date].push(slot);
      }
    }
  }

  // Compute break deduction per shift-day for each staff member
  const breakDeductMinutes = (bc && bc.breakRules)
    ? bc.breakRules.reduce(function (sum, b) { return sum + b.durationMinutes; }, 0)
    : 0;
  const breakDeductHours = breakDeductMinutes / 60;
  const breakDeductionEnabled = bc && bc.breakDeduction && bc.breakDeduction.enabled;
  const breakAppliesTo = (bc && bc.breakDeduction && bc.breakDeduction.appliesTo) || 'both';
  function shouldDeductBreaksFor(s) {
    if (!breakDeductionEnabled) return false;
    if (breakAppliesTo === 'both') return true;
    if (breakAppliesTo === 'full-time') return s.employmentType === 'full-time';
    if (breakAppliesTo === 'part-time') return s.employmentType === 'part-time';
    return false;
  }

  // Compute per-staff eligible days and net hours from slot-level data
  const staffEligDays = {};
  for (const s of staff) {
    var elig = staffEligibility[s.id];
    var dayGross = {};
    for (var date in elig.daySlots) {
      dayGross[date] = elig.daySlots[date].length;
    }
    var days = Object.keys(dayGross);
    var netHours = 0;
    var deductForThisStaff = shouldDeductBreaksFor(s);
    for (var di = 0; di < days.length; di++) {
      netHours += deductForThisStaff ? dayGross[days[di]] - breakDeductHours : dayGross[days[di]];
    }
    staffEligDays[s.id] = { dayGross: dayGross, days: days, netHours: netHours };
  }

  // Pre-compute FT slot targets
  const ftSlotTargets = {};
  for (const s of staff) {
    if (s.employmentType !== 'full-time' || !ftHours) continue;
    var eligDaysInfo = staffEligDays[s.id];
    var numDays = eligDaysInfo.days.length;
    if (numDays === 0) continue;
    var totalEligSlots = 0;
    for (var di = 0; di < eligDaysInfo.days.length; di++) {
      totalEligSlots += eligDaysInfo.dayGross[eligDaysInfo.days[di]];
    }
    var ftBreakDeduct = shouldDeductBreaksFor(s) ? breakDeductHours : 0;
    var targetGross = Math.min(ftHours.target + ftBreakDeduct * numDays, totalEligSlots);
    var minGross = Math.min(ftHours.min + ftBreakDeduct * numDays, totalEligSlots);
    var maxGross = Math.min(ftHours.max + ftBreakDeduct * numDays, totalEligSlots);
    var slotsPerDay = Math.round(targetGross / numDays);
    ftSlotTargets[s.id] = { targetGross: targetGross, minGross: minGross, maxGross: maxGross, slotsPerDay: slotsPerDay, eligDays: numDays, totalEligSlots: totalEligSlots };
  }

  // Step 5: Build eligibility guide with per-slot-hour lines (no range compression)
  const slotsByDay = {};
  for (const slot of uniqueSlots) {
    if (!slotsByDay[slot.day]) slotsByDay[slot.day] = [];
    slotsByDay[slot.day].push(slot);
  }

  const eligLines = [];
  const dayOrder = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  for (const day of dayOrder) {
    const daySlots = slotsByDay[day];
    if (!daySlots) continue;
    if (eligLines.length > 0) eligLines.push(''); // blank line between days
    for (const slot of daySlots) {
      var slack = slot.eligible.length - slot.minStaff;
      var maxLabel = slot.maxStaff ? ', max ' + slot.maxStaff : '';
      var annotation = '';
      if (slack === 0) {
        annotation = ' [assign all]';
      } else if (slack < 0) {
        annotation = ' [shortfall: ' + (-slack) + ']';
      }
      var line = slot.day + ' ' + slot.role + ' h' + slot.hour + ' (min ' + slot.minStaff + maxLabel + '): [' + slot.eligible.join(', ') + ']' + annotation;
      eligLines.push(line);
    }
  }

  const eligibility_guide = 'COVERAGE REQUIREMENTS (assign eligible staff per slot-hour):\n\n' + eligLines.join('\n');

  // Build staffing plan with hour budgets, staff windows, must-assign

  // Hour budget lines with forced/remaining breakdown
  const budgetLines = staff.map(function (s) {
    const type = s.employmentType === 'full-time' ? 'full-time' : 'part-time';
    const elig = staffEligibility[s.id];

    var line;
    if (type === 'full-time' && ftHours && ftSlotTargets[s.id]) {
      var ft = ftSlotTargets[s.id];
      var totalBreakH = breakDeductHours * ft.eligDays;
      if (variationType === 'cost_optimised') {
        line = '  ' + s.id + ': full-time ' + (s.qualifications || []).join('/') + ', TARGET ' + ft.targetGross + ' gross slots (' + ftHours.target + 'h net + ' + totalBreakH + 'h breaks). Stay at target. Hard ceiling ' + ft.maxGross;
      } else if (variationType === 'fairness_optimised') {
        line = '  ' + s.id + ': full-time ' + (s.qualifications || []).join('/') + ', TARGET ' + ft.targetGross + ' gross slots (' + ftHours.target + 'h net + ' + totalBreakH + 'h breaks), min ' + ft.minGross + '. Aim toward max ' + ft.maxGross + ' to maximize hours.';
      } else {
        line = '  ' + s.id + ': full-time ' + (s.qualifications || []).join('/') + ', TARGET ' + ft.targetGross + ' gross slots (' + ftHours.target + 'h net + ' + totalBreakH + 'h breaks), min ' + ft.minGross + ', max ' + ft.maxGross;
      }
      return line;
    } else if (type === 'full-time' && ftHours) {
      line = '  ' + s.id + ': full-time, 0 eligible days (on leave)';
      return line;
    } else {
      var roles = (s.qualifications || []).join('/');
      line = '  ' + s.id + ': ' + type + ', ' + roles + ', ' + (s.level || '?');
    }
    return line;
  });

  // Must-assign staff (few eligible days)
  var mustAssignLines = [];
  for (const s of staff) {
    var elig = staffEligibility[s.id];
    var eligDays = Object.keys(elig.daySlots).length;
    if (eligDays === 0 || elig.totalSlotHours > 20) continue;
    // Include staff with few eligible hours
    if (s.employmentType === 'full-time') continue;
    if (elig.totalSlotHours > 8 && variationType !== 'fairness_optimised') continue;
    var dayList = Object.keys(elig.daySlots).map(function (d) { return getDayAbbrev(d); });
    if (eligDays === 1) {
      mustAssignLines.push('  ' + s.id + ': ' + elig.totalSlotHours + 'h eligible on ' + dayList[0] + ' — assign to meet coverage');
    } else {
      mustAssignLines.push('  ' + s.id + ': ' + elig.totalSlotHours + 'h eligible across ' + eligDays + ' days [' + dayList.join(', ') + '] — assign to meet coverage');
    }
  }

  // PT fairness checklist — list all part-time staff sorted by eligible hours (fewest first)
  var ptChecklistLines = [];
  var ptStaff = staff.filter(function (s) { return s.employmentType !== 'full-time'; });
  ptStaff.sort(function (a, b) {
    var aElig = staffEligibility[a.id] ? staffEligibility[a.id].totalSlotHours : 0;
    var bElig = staffEligibility[b.id] ? staffEligibility[b.id].totalSlotHours : 0;
    return aElig - bElig;
  });
  for (var pi = 0; pi < ptStaff.length; pi++) {
    var ps = ptStaff[pi];
    var psElig = staffEligibility[ps.id];
    var psDays = staffEligDays[ps.id];
    var dayList = psDays ? psDays.days.map(function (d) { return getDayAbbrev(d); }).join(', ') : 'none';
    var eligDayCount = Object.keys(psElig.daySlots).length;
    ptChecklistLines.push('  ' + ps.id + ': ' + psElig.totalSlotHours + ' eligible hours, ' + eligDayCount + ' days, days: [' + dayList + ']');
  }

  // Assemble staffing plan
  const staffPlanParts = ['STAFF HOUR BUDGETS (each slot = 1 hour):'];
  staffPlanParts.push.apply(staffPlanParts, budgetLines);
  if (mustAssignLines.length > 0) {
    staffPlanParts.push('');
    staffPlanParts.push('MUST-ASSIGN STAFF (very few eligible slots — prioritize these):');
    staffPlanParts.push.apply(staffPlanParts, mustAssignLines);
  }
  if (ptChecklistLines.length > 0) {
    staffPlanParts.push('');
    if (variationType === 'cost_optimised') {
      staffPlanParts.push('PART-TIME STAFF (assign only to fill coverage gaps below minStaff):');
    } else if (variationType === 'fairness_optimised') {
      staffPlanParts.push('PART-TIME FAIRNESS CHECKLIST (ensure each gets shifts — fewest eligible hours first):');
    } else {
      staffPlanParts.push('PART-TIME FAIRNESS CHECKLIST (give each staff 1 shift, then fill coverage gaps only):');
    }
    staffPlanParts.push.apply(staffPlanParts, ptChecklistLines);
  }

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
    // Per-day eligible slot breakdown
    var eligDaysInfo = staffEligDays[s.id];
    var dayBreakdownParts = [];
    for (var dbi = 0; dbi < eligDaysInfo.days.length; dbi++) {
      var dDate = eligDaysInfo.days[dbi];
      var dDay = getDayAbbrev(dDate);
      var dSlots = eligDaysInfo.dayGross[dDate];
      dayBreakdownParts.push(dDay.charAt(0).toUpperCase() + dDay.slice(1) + '=' + dSlots);
    }
    ftScheduleLines.push('    Day breakdown: ' + dayBreakdownParts.join(', '));
    if (ft.totalEligSlots > ft.maxGross) {
      ftScheduleLines.push('    ⚠ ' + ft.totalEligSlots + ' eligible slots > ' + ft.maxGross + ' max gross — exceeding max triggers overtime pay. Trim slots from START of lowest-demand days to stay within budget.');
    }
  }
  if (ftScheduleLines.length > 0) {
    staffPlanParts.push('');
    staffPlanParts.push('FULL-TIME STAFF (schedule these first — assign target slots as continuous blocks each day):');
    staffPlanParts.push.apply(staffPlanParts, ftScheduleLines);
  }
  const staffing_plan = staffPlanParts.join('\n');

  // Scheduling parameters
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
    if (bc.weights) {
      var w = bc.weights;
      parts.push('Optimisation weights: cost=' + w.cost + ', fairness=' + w.fairness + ', preference=' + w.preference);
    }
    parts.push('Minimum shift length: ' + minShiftHours + ' hours — every assignment must be a continuous block of at least ' + minShiftHours + ' hours');
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
    business_rules = softRules.map(function (r) { return 'PREFER (confidence: ' + (r.confidence != null ? r.confidence.toFixed(1) : '1.0') + '): ' + r.ruleText; }).join('\n');
  }

  // Staff availability
  const availLines = staff.map(function (s) {
    var elig = staffEligibility[s.id];
    if (elig && Object.keys(elig.daySlots).length > 0) {
      var dates = Object.keys(elig.daySlots).sort();
      var windows = dates.map(function (date) {
        var dayAbbr = getDayAbbrev(date);
        var hours = elig.daySlots[date].map(function (sl) { return sl.hour; }).sort(function (a, b) { return a - b; });
        var minH = hours[0];
        var maxH = hours[hours.length - 1];
        if (minH === maxH) return dayAbbr + ' h' + minH;
        return dayAbbr + ' h' + minH + '-h' + maxH;
      }).join(', ');
      return '  ' + s.id + ' (' + (s.qualifications || []).join('/') + ', ' + (s.level || '?') + '): ' + windows;
    }
    return null;
  }).filter(Boolean);

  // Add lines for staff with empty availability
  for (const s of staff) {
    if (!s.availability || s.availability.length === 0) {
      availLines.push('  ' + s.id + ' (' + (s.qualifications || []).join('/') + ', ' + (s.level || '?') + '): no availability this week');
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
  hours_tracking += '\n- Track total assigned slots against hour limits';

  // Constraint tiers
  const tierLines = ['CONSTRAINT TIERS:', 'CRITICAL (never violate):'];
  tierLines.push('- Only assign staff to slots where they appear in the eligible list for that time range');
  tierLines.push('- Assign part-time staff only to slots where they are eligible');
  if (ftHours) {
    tierLines.push('- Full-time staff must not exceed ' + ftHours.max + ' total slot assignments');
    tierLines.push('- Full-time staff must be scheduled for at least ' + ftHours.min + 'h/week (after break deductions)');
  }
  tierLines.push('- Every FEASIBLE range must be staffed to AT LEAST minStaff');
  const constraint_tiers = tierLines.join('\n');

  // Soft goals with priority order
  const goalLines = [];

  // Priority order from weights
  const weightEntries = bc && bc.weights ? Object.entries(bc.weights).sort(function (a, b) { return b[1] - a[1]; }) : [];
  goalLines.push('PRIORITY ORDER (when goals conflict):');
  goalLines.push('1. Coverage — every feasible range staffed to at least minStaff');
  goalLines.push('2. Hour limits — never exceed hard ceilings (fullTimeHours.max)');
  if (variationType === 'cost_optimised') {
    goalLines.push('3. Full-time targets — schedule close to target hours');
    goalLines.push('4. Cost — minimize total labor cost');
    goalLines.push('5. Fairness — distribute shifts across staff where possible');
  } else if (variationType === 'fairness_optimised') {
    goalLines.push('3. Fairness — every staff member who submitted availability must get at least 1 shift of ' + minShiftHours + '+ hours this week');
    goalLines.push('4. Full-time targets — schedule close to target hours');
    goalLines.push('5. Cost — minimize total labor cost');
  } else {
    goalLines.push('3. Full-time targets — schedule close to target hours');
    goalLines.push('4. Fairness — every staff member who submitted availability must get at least 1 shift of ' + minShiftHours + '+ hours this week');
    var priorityNum = 5;
    for (const entry of weightEntries) {
      if (entry[0] === 'fairness') {
        // Already listed above — skip
      } else if (entry[0] === 'cost' && entry[1] > 0) {
        goalLines.push(priorityNum + '. Cost (weight ' + entry[1] + ') — minimize total labor cost');
        priorityNum++;
      } else if (entry[0] === 'preference' && entry[1] > 0) {
        goalLines.push(priorityNum + '. Preference (weight ' + entry[1] + ') — maximize preference adherence');
        priorityNum++;
      }
    }
  }

  goalLines.push('');
  goalLines.push('SOFT GOALS (optimise but don\'t sacrifice critical constraints):');
  for (const r of softRules) {
    goalLines.push('- ' + r.ruleText);
  }
  if (!softRules.some(function (r) { return /fair/i.test(r.ruleText); })) {
    goalLines.push('- Distribute slot assignments fairly across staff');
  }
  if (!softRules.some(function (r) { return /cost/i.test(r.ruleText); })) {
    goalLines.push('- Minimize total labor cost while meeting all constraints');
  }
  const soft_goals = goalLines.join('\n');

  // Date mapping: day abbreviation → ISO date (for output conversion)
  const dateMappingEntries = [];
  for (const slot of uniqueSlots) {
    var entry = slot.day + ' = ' + slot.date;
    if (dateMappingEntries.indexOf(entry) === -1) dateMappingEntries.push(entry);
  }
  const date_mapping = 'DATE MAPPING (use these dates in your output):\n' + dateMappingEntries.join('\n');

  // Variation-aware template variables
  var variation_guidance, fairness_check, pt_coverage_rule, ft_hours_rule;

  if (variationType === 'cost_optimised') {
    variation_guidance = 'OPTIMIZATION: MINIMIZE COST\n- Every slot-hour must have at least minStaff assigned — this is non-negotiable\n- Target exactly minStaff (do not exceed unless forced or FT targets require it)\n- Do not add PT staff beyond minStaff for fairness — coverage efficiency is the priority\n- FT staff: stay at target gross slots, do not fill to max';
    fairness_check = 'COVERAGE EFFICIENCY: After placing FT staff, fill all slots where assigned < minStaff with PT staff. Avoid exceeding maxStaff.';
    pt_coverage_rule = 'PT staff: after FT placement, assign PT to every slot-hour where assigned < minStaff (mandatory), then stop';
    ft_hours_rule = 'Full-time staff: assign their TARGET gross slots (see FULL-TIME STAFF section). Stay at target — do not fill toward max unless coverage requires it.';
  } else if (variationType === 'fairness_optimised') {
    variation_guidance = 'OPTIMIZATION: MAXIMIZE FAIRNESS\n- Every staff member who submitted availability must get at least 1 shift\n- Distribute hours as evenly as possible across all available staff\n- Assign up to maxStaff when it helps give shifts to underserved staff\n- FT staff: fill toward max gross slots to maximize their hours';
    fairness_check = 'FAIRNESS CHECK: After placing FT staff: (1) Fill all slots where assigned < minStaff with eligible staff. (2) Then check if any staff with availability have 0 assignments — every staff member who submitted availability MUST get at least one shift this week (minimum shift length). Assign them a continuous block on one day. Prefer days/ranges where they fill coverage gaps. Avoid exceeding maxStaff in any slot.';
    pt_coverage_rule = 'PT staff: assign to ensure everyone gets at least 1 shift this week';
    ft_hours_rule = 'Full-time staff: assign up to their MAX gross slots (see FULL-TIME STAFF section) to maximize hours.';
  } else {
    variation_guidance = 'OPTIMIZATION: BALANCED\n- Every slot-hour must have at least minStaff assigned — this is non-negotiable\n- Give each available staff member at least 1 shift for fairness\n- After meeting minStaff and the fairness minimum, prefer minStaff per slot to control cost\n- FT staff: aim for target gross slots';
    fairness_check = 'FAIRNESS CHECK: After placing FT staff: (1) Fill all slots where assigned < minStaff with eligible staff. (2) Then give each unassigned staff member exactly one shift (minimum shift length) on their best-fit day. Prefer days/ranges where they fill coverage gaps. Do not assign additional shifts beyond the 1-shift minimum unless needed for minStaff. Avoid exceeding maxStaff.';
    pt_coverage_rule = 'PT staff: give each person 1 shift for fairness, then assign to fill remaining gaps below minStaff';
    ft_hours_rule = 'Full-time staff: assign their TARGET gross slots (see FULL-TIME STAFF section).';
  }

  return {
    ...vars,
    input: raw,
    eligibility_guide: eligibility_guide,
    staffing_plan: staffing_plan,
    date_mapping: date_mapping,
    scheduling_params: scheduling_params,
    business_rules: business_rules,
    staff_availability: staff_availability,
    hours_tracking: hours_tracking,
    constraint_tiers: constraint_tiers,
    soft_goals: soft_goals,
    variation_guidance: variation_guidance,
    fairness_check: fairness_check,
    pt_coverage_rule: pt_coverage_rule,
    ft_hours_rule: ft_hours_rule,
  };
};
