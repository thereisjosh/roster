import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/llm", () => ({
  callWithFallback: vi.fn(),
}));

import { computeWeekStart, parseAvailability } from "@/lib/availability/nl-parser";
import { callWithFallback } from "@/lib/llm";

const mockCallWithFallback = vi.mocked(callWithFallback);

describe("computeWeekStart", () => {
  it("Wed 2026-05-06 + weekStartDay=1 → Mon 2026-05-04", () => {
    const wed = new Date(Date.UTC(2026, 4, 6, 12, 0, 0));
    const result = computeWeekStart(wed, 1);
    expect(result.toISOString().slice(0, 10)).toBe("2026-05-04");
  });

  it("Sun 2026-05-03 + weekStartDay=0 → Sun 2026-05-03", () => {
    const sun = new Date(Date.UTC(2026, 4, 3, 12, 0, 0));
    const result = computeWeekStart(sun, 0);
    expect(result.toISOString().slice(0, 10)).toBe("2026-05-03");
  });

  it("Mon 2026-05-04 + weekStartDay=1 → Mon 2026-05-04", () => {
    const mon = new Date(Date.UTC(2026, 4, 4, 12, 0, 0));
    const result = computeWeekStart(mon, 1);
    expect(result.toISOString().slice(0, 10)).toBe("2026-05-04");
  });
});

describe("parseAvailability", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("LLM format {slots: [...]} → passes through valid slots", async () => {
    const slots = [
      { day: "2026-05-04", startTime: "09:00", endTime: "17:00", preference: "available" },
      { day: "2026-05-05", startTime: "09:00", endTime: "17:00", preference: "available" },
    ];
    mockCallWithFallback.mockResolvedValue({
      content: JSON.stringify({ slots }),
    } as never);

    const result = await parseAvailability("Mon-Tue 9-5", "b1", 1);

    expect(result.slots).toEqual(slots);
    expect(result.weekStart).toBeInstanceOf(Date);
  });

  it("filters out slots missing required fields", async () => {
    mockCallWithFallback.mockResolvedValue({
      content: JSON.stringify({
        slots: [
          { day: "2026-05-04", startTime: "09:00", endTime: "17:00", preference: "available" },
          { day: "2026-05-05" },
        ],
      }),
    } as never);

    const result = await parseAvailability("Monday", "b1", 1);

    expect(result.slots).toHaveLength(1);
    expect(result.slots[0].day).toBe("2026-05-04");
  });

  it("deterministic format {entries: [{day, available:false}]} → normalizes to ISO dates + unavailable", async () => {
    mockCallWithFallback.mockResolvedValue({
      content: JSON.stringify({
        entries: [{ day: "monday", available: false }],
      }),
    } as never);

    const result = await parseAvailability("Monday off", "b1", 1);

    expect(result.slots).toHaveLength(1);
    expect(result.slots[0].preference).toBe("unavailable");
    expect(result.slots[0].startTime).toBe("00:00");
    expect(result.slots[0].endTime).toBe("23:59");
    expect(result.slots[0].day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("deterministic format with timeRange uses those times", async () => {
    mockCallWithFallback.mockResolvedValue({
      content: JSON.stringify({
        entries: [{ day: "tuesday", available: true, timeRange: "09:00-17:00" }],
      }),
    } as never);

    const result = await parseAvailability("Tuesday 9-5", "b1", 1);

    expect(result.slots).toHaveLength(1);
    expect(result.slots[0].startTime).toBe("09:00");
    expect(result.slots[0].endTime).toBe("17:00");
    expect(result.slots[0].preference).toBe("available");
  });

  it("empty/malformed response → returns {slots: [], weekStart}", async () => {
    mockCallWithFallback.mockResolvedValue({
      content: "this is not json at all",
    } as never);

    const result = await parseAvailability("???", "b1", 1);

    expect(result.slots).toEqual([]);
    expect(result.weekStart).toBeInstanceOf(Date);
  });
});
