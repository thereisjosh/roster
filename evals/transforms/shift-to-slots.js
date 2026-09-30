/**
 * Output transform: shift-level LLM output → slot-level format.
 *
 * For Eval A (shift input, scored at slot level). Takes the LLM's shift-based
 * assignments and expands them into hourly slot entries matching the slot scorer format.
 *
 * SlotId convention: {dayAbbrev}-{role}-{hour}
 */

const DAY_ABBREVS = { 0: 'sun', 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat' };

function getDayAbbrev(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  return DAY_ABBREVS[d.getUTCDay()];
}

function parseTime(t) {
  const [h, m] = t.split(':').map(Number);
  return h + m / 60;
}

module.exports = function (output, context) {
  // Strip markdown fences from LLM output (same as inline transform in other configs)
  if (typeof output === 'string') {
    output = output.replace(/^```(?:json)?\s*\n?/gm, '').replace(/\n?\s*```\s*$/gm, '').trim();
    var i = output.indexOf('{');
    var j = output.lastIndexOf('}');
    if (i !== -1 && j > i) output = output.substring(i, j + 1);
  }

  // Parse shift-level output
  let schedule;
  try {
    schedule = typeof output === 'string' ? JSON.parse(output) : output;
  } catch {
    return output; // can't transform, let scorer report the error
  }

  if (!schedule.assignments || !Array.isArray(schedule.assignments)) {
    return output;
  }

  // Build shift lookup from input
  let shiftMap = {};
  try {
    const input = typeof context.vars.input === 'string'
      ? JSON.parse(context.vars.input)
      : context.vars.input;
    for (const s of (input.shifts || [])) {
      shiftMap[s.id] = s;
    }
  } catch {
    // If we can't parse input, we can't expand — return as-is
    return output;
  }

  const slots = [];

  for (const assignment of schedule.assignments) {
    const shift = shiftMap[assignment.shiftId];
    if (!shift) continue;

    const startHour = parseTime(assignment.startTime || shift.startTime);
    const endHour = parseTime(assignment.endTime || shift.endTime);
    const dayAbbrev = getDayAbbrev(shift.date);
    const role = shift.requiredRole;

    const firstHour = Math.ceil(startHour - 0.001);
    const lastHour = Math.ceil(endHour - 0.001) - 1;

    for (let h = firstHour; h <= lastHour; h++) {
      slots.push({
        slotId: dayAbbrev + '-' + role + '-' + h,
        staffId: assignment.staffId,
        date: shift.date,
        hour: h,
        role: role,
      });
    }
  }

  slots.sort(function (a, b) {
    return a.date.localeCompare(b.date) || a.hour - b.hour || a.role.localeCompare(b.role) || a.staffId.localeCompare(b.staffId);
  });

  return JSON.stringify({ slots: slots });
};
