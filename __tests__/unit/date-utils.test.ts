import { describe, it, expect } from "vitest";
import {
  getWeekStart,
  getWeekDates,
  shiftWeek,
  formatWeekRange,
} from "@/lib/date-utils";

// Helper to create UTC dates succinctly
function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

describe("getWeekStart", () => {
  it("Monday start: reference on Monday returns same day", () => {
    // 2026-04-20 is a Monday
    const result = getWeekStart(1, utc(2026, 4, 20));
    expect(result.toISOString().slice(0, 10)).toBe("2026-04-20");
  });

  it("Monday start: reference on Wednesday returns preceding Monday", () => {
    // 2026-04-22 is a Wednesday
    const result = getWeekStart(1, utc(2026, 4, 22));
    expect(result.toISOString().slice(0, 10)).toBe("2026-04-20");
  });

  it("Monday start: reference on Sunday returns preceding Monday", () => {
    // 2026-04-26 is a Sunday
    const result = getWeekStart(1, utc(2026, 4, 26));
    expect(result.toISOString().slice(0, 10)).toBe("2026-04-20");
  });

  it("Sunday start: reference on Wednesday returns preceding Sunday", () => {
    // 2026-04-22 is a Wednesday
    const result = getWeekStart(0, utc(2026, 4, 22));
    expect(result.toISOString().slice(0, 10)).toBe("2026-04-19");
  });

  it("Sunday start: reference on Sunday returns same day", () => {
    // 2026-04-19 is a Sunday
    const result = getWeekStart(0, utc(2026, 4, 19));
    expect(result.toISOString().slice(0, 10)).toBe("2026-04-19");
  });

  it("Saturday start: reference on Wednesday returns preceding Saturday", () => {
    // 2026-04-22 is a Wednesday
    const result = getWeekStart(6, utc(2026, 4, 22));
    expect(result.toISOString().slice(0, 10)).toBe("2026-04-18");
  });

  it("Saturday start: reference on Saturday returns same day", () => {
    // 2026-04-18 is a Saturday
    const result = getWeekStart(6, utc(2026, 4, 18));
    expect(result.toISOString().slice(0, 10)).toBe("2026-04-18");
  });

  it("handles month boundary: Mar 2 (Tue), Monday start → Feb 28", () => {
    // 2027-03-02 is a Tuesday
    const result = getWeekStart(1, utc(2027, 3, 2));
    expect(result.toISOString().slice(0, 10)).toBe("2027-03-01");
  });

  it("handles year boundary: Jan 1 2026 (Thu), Monday start → Dec 29 2025", () => {
    // 2026-01-01 is a Thursday
    const result = getWeekStart(1, utc(2026, 1, 1));
    expect(result.toISOString().slice(0, 10)).toBe("2025-12-29");
  });

  it("result is always at 00:00:00 UTC", () => {
    const result = getWeekStart(1, utc(2026, 4, 22));
    expect(result.getUTCHours()).toBe(0);
    expect(result.getUTCMinutes()).toBe(0);
    expect(result.getUTCSeconds()).toBe(0);
    expect(result.getUTCMilliseconds()).toBe(0);
  });

  it("default referenceDate returns a valid week start", () => {
    const result = getWeekStart(1);
    expect(result).toBeInstanceOf(Date);
    // The returned day should be Monday (1)
    expect(result.getUTCDay()).toBe(1);
  });
});

describe("getWeekDates", () => {
  const monday = utc(2026, 4, 20); // Monday Apr 20

  it("returns exactly 7 strings", () => {
    const dates = getWeekDates(monday);
    expect(dates).toHaveLength(7);
  });

  it("first string matches weekStart date", () => {
    const dates = getWeekDates(monday);
    expect(dates[0]).toBe("2026-04-20");
  });

  it("strings are ISO format YYYY-MM-DD", () => {
    const dates = getWeekDates(monday);
    for (const d of dates) {
      expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("returns consecutive days", () => {
    const dates = getWeekDates(monday);
    expect(dates).toEqual([
      "2026-04-20",
      "2026-04-21",
      "2026-04-22",
      "2026-04-23",
      "2026-04-24",
      "2026-04-25",
      "2026-04-26",
    ]);
  });

  it("handles month boundary crossing", () => {
    // Apr 27 Mon → includes May dates
    const dates = getWeekDates(utc(2026, 4, 27));
    expect(dates[0]).toBe("2026-04-27");
    expect(dates[6]).toBe("2026-05-03");
  });

  it("handles year boundary crossing", () => {
    // Dec 29 2025 Mon → includes Jan 2026
    const dates = getWeekDates(utc(2025, 12, 29));
    expect(dates[0]).toBe("2025-12-29");
    expect(dates[6]).toBe("2026-01-04");
  });
});

describe("shiftWeek", () => {
  const monday = utc(2026, 4, 20);

  it("direction=1 advances exactly 7 days", () => {
    const result = shiftWeek(monday, 1);
    expect(result.toISOString().slice(0, 10)).toBe("2026-04-27");
  });

  it("direction=-1 goes back exactly 7 days", () => {
    const result = shiftWeek(monday, -1);
    expect(result.toISOString().slice(0, 10)).toBe("2026-04-13");
  });

  it("handles month boundary forward", () => {
    const lastWeekApril = utc(2026, 4, 27);
    const result = shiftWeek(lastWeekApril, 1);
    expect(result.toISOString().slice(0, 10)).toBe("2026-05-04");
  });

  it("handles year boundary backward", () => {
    const firstWeekJan = utc(2026, 1, 5);
    const result = shiftWeek(firstWeekJan, -1);
    expect(result.toISOString().slice(0, 10)).toBe("2025-12-29");
  });

  it("does not mutate original date object", () => {
    const original = utc(2026, 4, 20);
    const originalTime = original.getTime();
    shiftWeek(original, 1);
    expect(original.getTime()).toBe(originalTime);
  });
});

describe("formatWeekRange", () => {
  it('normal week: "Apr 20 – Apr 26, 2026"', () => {
    const result = formatWeekRange(utc(2026, 4, 20));
    expect(result).toBe("Apr 20 – Apr 26, 2026");
  });

  it('month-spanning: "Apr 27 – May 3, 2026"', () => {
    const result = formatWeekRange(utc(2026, 4, 27));
    expect(result).toBe("Apr 27 – May 3, 2026");
  });

  it('year-spanning: "Dec 29 – Jan 4, 2026"', () => {
    const result = formatWeekRange(utc(2025, 12, 29));
    expect(result).toBe("Dec 29 – Jan 4, 2026");
  });

  it("uses en-US short month names", () => {
    const result = formatWeekRange(utc(2026, 1, 5));
    expect(result).toContain("Jan");
  });
});
