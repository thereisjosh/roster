import type { BusinessConfig } from "@/lib/db/schema";

export function getDefaultConfig(): BusinessConfig {
  return {
    weekStartDay: 1, // Monday
    availabilityDeadlineDay: 3, // Wednesday
    availabilityDeadlineHour: 18, // 6 PM
    reminderIntervals: [48, 24, 2], // hours before deadline
    coverageRequirements: [
      { role: "barista", days: [1, 2, 3, 4, 5], startTime: "06:00", endTime: "14:00", minStaff: 2 },
      { role: "barista", days: [1, 2, 3, 4, 5], startTime: "14:00", endTime: "22:00", minStaff: 2 },
    ],
    maxConsecutiveDays: 6,
    minRestHoursBetweenShifts: 10,
    minShiftHours: 3,
    costWeight: 0.33,
    fairnessWeight: 0.34,
    preferenceWeight: 0.33,
    closedDays: [],
    fullTimeHours: { min: 35, target: 40, max: 44 },
    breakRules: [],
    breakDeduction: { enabled: false, appliesTo: "both" },
  };
}
