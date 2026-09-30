/**
 * Output transform: staff-grouped LLM output → slot-level format.
 *
 * For the compressed eval (compressed input, staff-grouped output).
 * Takes assignments like { staffId, role, date, hours: [11,12,13,14] }
 * and expands into hourly slot entries matching the slot scorer format.
 *
 * SlotId convention: {dayAbbrev}-{role}-{hour}
 */

const DAY_ABBREVS = { 0: 'sun', 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat' };

function getDayAbbrev(dateStr) {
  // Try standard ISO date first
  const d = new Date(dateStr + 'T00:00:00Z');
  if (!isNaN(d.getTime())) return DAY_ABBREVS[d.getUTCDay()];

  // Try ISO week format: "2025-W01-FRI" → extract day name
  const weekMatch = dateStr.match(/-(mon|tue|wed|thu|fri|sat|sun)$/i);
  if (weekMatch) return weekMatch[1].toLowerCase();

  // Try full day name
  const dayNames = { monday: 'mon', tuesday: 'tue', wednesday: 'wed', thursday: 'thu', friday: 'fri', saturday: 'sat', sunday: 'sun' };
  const lower = dateStr.toLowerCase();
  for (const [full, abbr] of Object.entries(dayNames)) {
    if (lower.includes(full) || lower.endsWith(abbr)) return abbr;
  }

  return undefined;
}

module.exports = function (output, context) {
  // Strip markdown fences from LLM output
  if (typeof output === 'string') {
    output = output.replace(/^```(?:json)?\s*\n?/gm, '').replace(/\n?\s*```\s*$/gm, '').trim();
    var i = output.indexOf('{');
    var j = output.lastIndexOf('}');
    if (i !== -1 && j > i) output = output.substring(i, j + 1);
  }

  // Parse staff-grouped output
  let schedule;
  try {
    schedule = typeof output === 'string' ? JSON.parse(output) : output;
  } catch {
    return output; // can't transform, let scorer report the error
  }

  if (!schedule.assignments || !Array.isArray(schedule.assignments)) {
    return output;
  }

  const slots = [];

  for (const assignment of schedule.assignments) {
    const { staffId, role, date, hours } = assignment;
    if (!staffId || !role || !date || !Array.isArray(hours)) continue;

    const dayAbbrev = getDayAbbrev(date);

    for (const h of hours) {
      slots.push({
        slotId: dayAbbrev + '-' + role + '-' + h,
        staffId: staffId,
        date: date,
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
