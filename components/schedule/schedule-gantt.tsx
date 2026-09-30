"use client";

import { Fragment } from "react";
import { cn } from "@/lib/utils";
import type { ShiftAssignment } from "@/lib/db/schema";
import type { ParsedWarning } from "@/lib/scheduling/parse-warnings";

interface ScheduleGanttProps {
  assignments: ShiftAssignment[];
  weekStart: Date;
  warnings?: ParsedWarning[];
}

const ROLE_COLORS: Record<string, { border: string; bg: string; text: string }> = {
  barista: {
    border: "border-l-blue-500",
    bg: "bg-blue-50 dark:bg-blue-950/40",
    text: "text-blue-700 dark:text-blue-300",
  },
  chef: {
    border: "border-l-orange-500",
    bg: "bg-orange-50 dark:bg-orange-950/40",
    text: "text-orange-700 dark:text-orange-300",
  },
  "sous chef": {
    border: "border-l-amber-500",
    bg: "bg-amber-50 dark:bg-amber-950/40",
    text: "text-amber-700 dark:text-amber-300",
  },
  foh: {
    border: "border-l-green-500",
    bg: "bg-green-50 dark:bg-green-950/40",
    text: "text-green-700 dark:text-green-300",
  },
};

const ROLE_LEGEND_COLORS: Record<string, string> = {
  barista: "bg-blue-500",
  chef: "bg-orange-500",
  "sous chef": "bg-amber-500",
  foh: "bg-green-500",
};

function getRoleStyle(shiftType: string) {
  const key = shiftType.toLowerCase();
  for (const [role, style] of Object.entries(ROLE_COLORS)) {
    if (key.includes(role)) return style;
  }
  return {
    border: "border-l-violet-500",
    bg: "bg-violet-50 dark:bg-violet-950/40",
    text: "text-violet-700 dark:text-violet-300",
  };
}

function getRoleLegendColor(shiftType: string) {
  const key = shiftType.toLowerCase();
  for (const [role, color] of Object.entries(ROLE_LEGEND_COLORS)) {
    if (key.includes(role)) return color;
  }
  return "bg-violet-500";
}

/** Parse "HH:mm" to fractional hours */
function parseTime(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h + m / 60;
}

function formatHour(t: string): string {
  // "09:00" → "9:00", "15:00" → "15:00"
  const [h, m] = t.split(":");
  return `${parseInt(h)}:${m}`;
}

/** Get the days of the week starting from weekStart */
function getWeekDays(weekStart: Date): { date: string; label: string }[] {
  const days: { date: string; label: string }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setUTCDate(d.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString("en-US", {
      weekday: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    days.push({ date: iso, label });
  }
  return days;
}

/** Resolve assignment day to ISO date string */
function resolveDay(day: string, weekStart: Date): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  const names: Record<string, number> = {
    Mon: 0, Monday: 0,
    Tue: 1, Tuesday: 1,
    Wed: 2, Wednesday: 2,
    Thu: 3, Thursday: 3,
    Fri: 4, Friday: 4,
    Sat: 5, Saturday: 5,
    Sun: 6, Sunday: 6,
  };
  const offset = names[day] ?? 0;
  const d = new Date(weekStart);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/** Check if a staff member has warnings for a given day */
function hasWarningForStaffDay(
  warnings: ParsedWarning[],
  staffName: string,
  _dayDate: string,
): { hasError: boolean; hasWarning: boolean } {
  if (!warnings.length) return { hasError: false, hasWarning: false };
  const name = staffName.toLowerCase();
  let hasError = false;
  let hasWarning = false;
  for (const w of warnings) {
    const lower = w.text.toLowerCase();
    if (lower.includes(name)) {
      if (w.severity === "error") hasError = true;
      else if (w.severity === "warning") hasWarning = true;
    }
  }
  return { hasError, hasWarning };
}

export function ScheduleGantt({ assignments, weekStart, warnings = [] }: ScheduleGanttProps) {
  if (assignments.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        No shift assignments in this variation.
      </p>
    );
  }

  const days = getWeekDays(weekStart);

  // Group assignments by staff name
  const byStaff = new Map<string, ShiftAssignment[]>();
  for (const a of assignments) {
    const list = byStaff.get(a.staffName) ?? [];
    list.push(a);
    byStaff.set(a.staffName, list);
  }
  const staffNames = [...byStaff.keys()].sort();

  // Collect unique roles for legend
  const roles = new Set<string>();
  for (const a of assignments) {
    roles.add(a.shiftType.toLowerCase());
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Shift Grid</h3>

      <div className="overflow-x-auto">
        <div className="min-w-[800px]">
          {/* Grid: 1 name column + 7 day columns */}
          <div
            className="grid border rounded-md"
            style={{ gridTemplateColumns: "minmax(100px, 140px) repeat(7, 1fr)" }}
          >
            {/* Header row */}
            <div className="px-2 py-2 text-xs font-medium text-muted-foreground border-b bg-muted/30">
              Staff
            </div>
            {days.map((d) => (
              <div
                key={d.date}
                className="px-2 py-2 text-xs font-medium text-muted-foreground text-center border-b border-l bg-muted/30"
              >
                {d.label}
              </div>
            ))}

            {/* Staff rows */}
            {staffNames.map((name, idx) => {
              const staffAssignments = byStaff.get(name)!;
              const isEven = idx % 2 === 0;
              return (
                <Fragment key={name}>
                  {/* Name cell */}
                  <div
                    className={cn(
                      "px-2 py-2 text-xs font-medium truncate border-b flex items-start",
                      isEven && "bg-muted/20",
                    )}
                  >
                    {name}
                  </div>
                  {/* Day cells */}
                  {days.map((d) => {
                    const dayAssignments = staffAssignments.filter(
                      (a) => resolveDay(a.day, weekStart) === d.date,
                    );
                    const { hasError, hasWarning } = hasWarningForStaffDay(
                      warnings,
                      name,
                      d.date,
                    );
                    return (
                      <div
                        key={`${name}-${d.date}`}
                        className={cn(
                          "px-1 py-1 border-b border-l min-h-[52px]",
                          isEven && "bg-muted/20",
                        )}
                      >
                        {dayAssignments.length === 0 ? (
                          <div className="h-full" />
                        ) : (
                          <div className="space-y-1">
                            {dayAssignments.map((a, ai) => {
                              const style = getRoleStyle(a.shiftType);
                              const hours =
                                parseTime(a.endTime) - parseTime(a.startTime);
                              return (
                                <div
                                  key={ai}
                                  className={cn(
                                    "rounded-md border-l-4 px-2 py-1 transition-all hover:shadow-sm hover:-translate-y-px cursor-default",
                                    style.border,
                                    style.bg,
                                  )}
                                  title={`${a.staffName} — ${a.shiftType}\n${a.startTime}–${a.endTime}\n${hours.toFixed(1)}h · $${a.cost.toFixed(2)}`}
                                >
                                  <div className="flex items-center gap-1">
                                    <span
                                      className={cn(
                                        "text-[10px] font-semibold capitalize",
                                        style.text,
                                      )}
                                    >
                                      {a.shiftType}
                                    </span>
                                    {(hasError || hasWarning) && (
                                      <span
                                        className={cn(
                                          "h-1.5 w-1.5 rounded-full shrink-0",
                                          hasError
                                            ? "bg-red-500"
                                            : "bg-amber-500",
                                        )}
                                      />
                                    )}
                                  </div>
                                  <div className="text-[10px] text-muted-foreground">
                                    {formatHour(a.startTime)}–
                                    {formatHour(a.endTime)}
                                    <span className="ml-1 opacity-60">
                                      {hours.toFixed(0)}h
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </Fragment>
              );
            })}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {[...roles].sort().map((role) => (
          <div key={role} className="flex items-center gap-1.5">
            <span
              className={cn(
                "inline-block h-3 w-3 rounded-sm",
                getRoleLegendColor(role),
              )}
            />
            <span className="capitalize">{role}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
