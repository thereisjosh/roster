/**
 * Gini coefficient calculator for shift distribution fairness.
 *
 * Gini = 0.0 → perfectly equal distribution
 * Gini = 1.0 → maximum inequality
 *
 * Used by the schedule scorer to measure how fairly undesirable shifts
 * (nights, weekends) are distributed across staff.
 */

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

/**
 * Score fairness of shift distribution.
 * Returns 0.0-1.0 where 1.0 is perfectly fair.
 */
export function fairnessScore(hoursPerStaff: number[]): number {
  if (hoursPerStaff.length === 0) return 1.0;
  const gini = calculateGini(hoursPerStaff);
  return Math.max(0, 1 - gini);
}

/**
 * Calculate undesirable shift distribution fairness.
 * Focuses specifically on weekend and night shifts.
 */
export function undesirableShiftFairness(
  assignments: Array<{ staffId: string; date: string; startTime: string; endTime: string }>,
): number {
  const undesirableHours: Record<string, number> = {};

  for (const a of assignments) {
    const dayOfWeek = new Date(a.date).getDay(); // 0=Sun, 6=Sat
    const startHour = parseInt(a.startTime.split(":")[0]);
    const endHour = parseInt(a.endTime.split(":")[0]);
    const hours = endHour - startHour;

    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isNight = startHour >= 18 || endHour >= 22;

    if (isWeekend || isNight) {
      undesirableHours[a.staffId] = (undesirableHours[a.staffId] ?? 0) + hours;
    }
  }

  const values = Object.values(undesirableHours);
  return fairnessScore(values);
}
