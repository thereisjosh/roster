/**
 * Week computation helpers. All dates use UTC to avoid timezone shift bugs.
 */

/** Computes the start-of-week date (at 00:00 UTC) containing the reference date. */
export function getWeekStart(
  weekStartDay: number,
  referenceDate: Date = new Date(),
): Date {
  const d = new Date(
    Date.UTC(
      referenceDate.getUTCFullYear(),
      referenceDate.getUTCMonth(),
      referenceDate.getUTCDate(),
    ),
  );
  const diff = (d.getUTCDay() - weekStartDay + 7) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

/** Returns 7 ISO date strings starting from weekStart, e.g. ["2026-04-20", ...] */
export function getWeekDates(weekStart: Date): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

/** Adds or subtracts 7 days from the given week start. */
export function shiftWeek(weekStart: Date, direction: 1 | -1): Date {
  const d = new Date(weekStart);
  d.setUTCDate(d.getUTCDate() + 7 * direction);
  return d;
}

/** Formats a week range like "Apr 20 – Apr 26, 2026". */
export function formatWeekRange(weekStart: Date): string {
  const end = new Date(weekStart);
  end.setUTCDate(end.getUTCDate() + 6);

  const fmtStart = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const fmtEnd = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

  return `${fmtStart.format(weekStart)} – ${fmtEnd.format(end)}`;
}
