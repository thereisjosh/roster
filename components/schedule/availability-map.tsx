"use client";

import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

type AvailStatus = "available" | "preferred" | "implicit" | "none";

const CELL_STYLES: Record<AvailStatus, string> = {
  available: "bg-green-200 dark:bg-green-900/40",
  preferred: "bg-blue-200 dark:bg-blue-900/40",
  implicit: "bg-gray-200/60 dark:bg-gray-700/30 border-dashed",
  none: "",
};

const LABEL_MAP: Record<AvailStatus, string> = {
  available: "A",
  preferred: "P",
  implicit: "I",
  none: "",
};

function formatTime(t: string) {
  return t.slice(0, 5); // "11:00" → "11:00"
}

function employmentLabel(type: string) {
  if (type === "full_time") return "FT";
  if (type === "part_time") return "PT";
  return "C";
}

interface AvailabilityMapProps {
  weekStart: Date;
}

export function AvailabilityMap({ weekStart }: AvailabilityMapProps) {
  const { data, isLoading } = trpc.schedule.getAvailabilityMap.useQuery({
    weekStart,
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading availability map...</p>;
  }

  if (!data || data.days.length === 0) {
    return <p className="text-sm text-muted-foreground">No shift data available.</p>;
  }

  // Flatten all shift columns
  const shiftColumns = data.days.flatMap((d) =>
    d.shifts.map((s) => ({ ...s, date: d.date, dayName: d.dayName })),
  );
  const totalCols = shiftColumns.length;

  // Compute coverage counts per shift
  const coverageCounts = shiftColumns.map((col) => {
    let count = 0;
    for (const s of data.staff) {
      const status = s.availability[col.id];
      if (status && status !== "none") count++;
    }
    return count;
  });

  // Compute day column spans for grouped headers
  const daySpans = data.days.map((d) => ({
    dayName: d.dayName,
    date: d.date,
    span: d.shifts.length,
  }));

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Availability Map</h3>

      <div className="overflow-x-auto">
        <div
          className="grid gap-px text-xs"
          style={{
            gridTemplateColumns: `minmax(120px, auto) repeat(${totalCols}, minmax(52px, 1fr))`,
          }}
        >
          {/* Row 1: Day headers (spanning their shifts) */}
          <div />
          {daySpans.map((d) => (
            <div
              key={d.date}
              className="text-center font-medium text-muted-foreground border-b pb-0.5"
              style={{ gridColumn: `span ${d.span}` }}
            >
              {d.dayName} {new Date(d.date + "T00:00:00Z").getUTCDate()}
            </div>
          ))}

          {/* Row 2: Shift names */}
          <div />
          {shiftColumns.map((col) => (
            <div
              key={col.id}
              className="text-center text-[10px] text-muted-foreground truncate"
            >
              {col.name}
            </div>
          ))}

          {/* Row 3: Shift times */}
          <div />
          {shiftColumns.map((col) => (
            <div
              key={`time-${col.id}`}
              className="text-center text-[10px] text-muted-foreground"
            >
              {formatTime(col.startTime)}-{formatTime(col.endTime)}
            </div>
          ))}

          {/* Staff rows */}
          {data.staff.map((s) => (
            <div key={s.id} className="contents">
              {/* Name cell */}
              <div className="flex items-center gap-1.5 pr-2 py-0.5 truncate">
                <span className="font-medium truncate">{s.name}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  ({employmentLabel(s.employmentType)})
                </span>
              </div>
              {/* Availability cells */}
              {shiftColumns.map((col) => {
                const status = (s.availability[col.id] ?? "none") as AvailStatus;
                return (
                  <div
                    key={`${s.id}-${col.id}`}
                    className={cn(
                      "rounded-sm h-6 flex items-center justify-center border",
                      status === "none"
                        ? "border-transparent"
                        : "border-border/50",
                      CELL_STYLES[status],
                    )}
                    title={`${s.name} — ${col.id}: ${status}`}
                  >
                    <span className="text-[10px] text-muted-foreground">
                      {LABEL_MAP[status]}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}

          {/* Separator */}
          <div
            className="border-t col-span-full my-1"
            style={{ gridColumn: `1 / -1` }}
          />

          {/* Footer: Coverage row */}
          <div className="font-medium text-muted-foreground pr-2 py-0.5">
            Coverage
          </div>
          {shiftColumns.map((col, i) => {
            const available = coverageCounts[i];
            const required = col.minStaff;
            const isShort = available < required;
            return (
              <div
                key={`cov-${col.id}`}
                className={cn(
                  "text-center py-0.5 font-medium rounded-sm",
                  isShort
                    ? "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30"
                    : "text-green-600 dark:text-green-400",
                )}
              >
                {available}/{required}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className={cn("inline-block h-3 w-3 rounded", CELL_STYLES.available)} />
          Available
        </div>
        <div className="flex items-center gap-1.5">
          <span className={cn("inline-block h-3 w-3 rounded", CELL_STYLES.preferred)} />
          Preferred
        </div>
        <div className="flex items-center gap-1.5">
          <span className={cn("inline-block h-3 w-3 rounded border border-dashed border-border/50", CELL_STYLES.implicit)} />
          Implicit (FT)
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded border border-dashed border-border" />
          None
        </div>
      </div>
    </div>
  );
}
