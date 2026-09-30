import { callWithFallback } from "@/lib/llm";
import { getWeekStart } from "@/lib/date-utils";
import type { AvailabilitySlot } from "@/lib/db/schema";

export function computeWeekStart(now: Date, weekStartDay: number): Date {
  return getWeekStart(weekStartDay, now);
}

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function dayNameToWeekOffset(dayName: string, weekStartDay: number): number {
  const dayIndex = DAY_NAMES.indexOf(dayName.toLowerCase());
  if (dayIndex === -1) return -1;
  return (dayIndex - weekStartDay + 7) % 7;
}

function formatDate(weekStart: Date, offset: number): string {
  const d = new Date(weekStart);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/**
 * Normalize both LLM format ({slots: [...]}) and deterministic fallback format
 * ({entries: [{day, available, timeRange?}]}) into AvailabilitySlot[].
 */
function normalizeSlots(
  parsed: Record<string, unknown>,
  weekStart: Date,
  weekStartDay: number,
): AvailabilitySlot[] {
  // LLM format: {slots: [{day, startTime, endTime, preference}]}
  if (Array.isArray(parsed.slots)) {
    return (parsed.slots as AvailabilitySlot[]).filter(
      (s) => s.day && s.startTime && s.endTime && s.preference,
    );
  }

  // Deterministic fallback format: {entries: [{day, available, timeRange?}]}
  if (Array.isArray(parsed.entries)) {
    return (parsed.entries as Array<{ day: string; available: boolean; timeRange?: string }>).map(
      (entry) => {
        const offset = dayNameToWeekOffset(entry.day, weekStartDay);
        const day = offset >= 0 ? formatDate(weekStart, offset) : entry.day;

        let startTime = "00:00";
        let endTime = "23:59";
        if (entry.timeRange) {
          const parts = entry.timeRange.split("-");
          if (parts.length === 2) {
            startTime = parts[0].trim();
            endTime = parts[1].trim();
          }
        }

        return {
          day,
          startTime,
          endTime,
          preference: entry.available ? "available" : "unavailable",
        } as AvailabilitySlot;
      },
    );
  }

  return [];
}

export async function parseAvailability(
  message: string,
  businessId: string,
  weekStartDay: number,
): Promise<{ slots: AvailabilitySlot[]; weekStart: Date }> {
  const now = new Date();
  const weekStart = computeWeekStart(now, weekStartDay);

  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setUTCDate(d.getUTCDate() + i);
    return `${DAY_NAMES[d.getUTCDay()]}: ${d.toISOString().slice(0, 10)}`;
  });

  const response = await callWithFallback({
    taskType: "nl_availability_parsing",
    businessId,
    prompt: message,
    systemPrompt: `You parse natural-language availability messages into structured data.

Today is ${now.toISOString().slice(0, 10)}.
The current week starts on ${DAY_NAMES[weekStartDay]} (${weekStart.toISOString().slice(0, 10)}).
Week dates:
${weekDates.join("\n")}

Return JSON: {"slots": [{"day": "YYYY-MM-DD", "startTime": "HH:mm", "endTime": "HH:mm", "preference": "available"|"unavailable"|"preferred"}]}

Rules:
- If no times specified, use "00:00"-"23:59" for the full day
- "off" / "cannot work" / "leave" → preference "unavailable"
- "available" / "can work" → preference "available"
- "Mon-Fri 9-5" means Monday through Friday, each 09:00-17:00, preference "available"
- Only include days explicitly mentioned`,
    jsonMode: true,
    temperature: 0,
  });

  try {
    const parsed = JSON.parse(response.content);
    const slots = normalizeSlots(parsed, weekStart, weekStartDay);
    return { slots, weekStart };
  } catch {
    return { slots: [], weekStart };
  }
}
