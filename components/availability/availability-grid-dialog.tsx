"use client";

import React, { useState, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AvailabilitySlot } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

type Preference = "preferred" | "available" | "unavailable";

interface HourBlock {
  startTime: string;
  endTime: string;
  label: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staffId: string;
  staffName: string;
  weekStart: Date;
  weekDates: string[]; // already filtered to open days
  hourBlocks: HourBlock[];
  operatingHours: Record<string, { open: string; close: string }>;
  existingSlots: AvailabilitySlot[];
}

const CELL_STYLES: Record<Preference, string> = {
  unavailable: "bg-muted text-muted-foreground",
  available: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  preferred: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
};

const PAINT_BTN_STYLES: Record<Preference, string> = {
  unavailable: "bg-muted text-foreground",
  available: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  preferred: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
};

function cellKey(day: string, startTime: string) {
  return `${day}|${startTime}`;
}

function parseTimeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function formatDayHeader(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "UTC",
  }).format(d);
  const num = d.getUTCDate();
  return `${day} ${num}`;
}

function isCellInOperatingHours(
  dateStr: string,
  block: HourBlock,
  operatingHours: Record<string, { open: string; close: string }>,
): boolean {
  const d = new Date(dateStr + "T00:00:00Z");
  const dayKey = String(d.getUTCDay());
  const dayHours = operatingHours[dayKey];
  if (!dayHours) return false;
  const openMin = parseTimeToMinutes(dayHours.open);
  const closeMin = parseTimeToMinutes(dayHours.close);
  const blockStart = parseTimeToMinutes(block.startTime);
  const blockEnd = parseTimeToMinutes(block.endTime);
  return blockStart >= openMin && blockEnd <= closeMin;
}

export function AvailabilityGridDialog({
  open,
  onOpenChange,
  staffId,
  staffName,
  weekStart,
  weekDates,
  hourBlocks,
  operatingHours,
  existingSlots,
}: Props) {
  const [grid, setGrid] = useState<Record<string, Preference>>({});
  const [paintMode, setPaintMode] = useState<Preference>("available");
  const [dragging, setDragging] = useState(false);
  const utils = trpc.useUtils();

  // End drag on pointer up anywhere
  useEffect(() => {
    const up = () => setDragging(false);
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  // Initialize grid when dialog opens
  useEffect(() => {
    if (!open) return;

    const initial: Record<string, Preference> = {};

    // Default all valid cells to unavailable
    for (const date of weekDates) {
      for (const block of hourBlocks) {
        if (isCellInOperatingHours(date, block, operatingHours)) {
          initial[cellKey(date, block.startTime)] = "unavailable";
        }
      }
    }

    // Overlay existing slots by checking time overlap with hour blocks
    for (const slot of existingSlots) {
      if (!weekDates.includes(slot.day)) continue;
      const slotStart = parseTimeToMinutes(slot.startTime);
      const slotEnd = parseTimeToMinutes(slot.endTime);
      for (const block of hourBlocks) {
        const blockStart = parseTimeToMinutes(block.startTime);
        const blockEnd = parseTimeToMinutes(block.endTime);
        // Block is covered if it's fully within the slot
        if (slotStart <= blockStart && slotEnd >= blockEnd) {
          const key = cellKey(slot.day, block.startTime);
          if (key in initial) {
            initial[key] = slot.preference;
          }
        }
      }
    }

    setGrid(initial);
  }, [open, weekDates, hourBlocks, operatingHours, existingSlots]);

  const paint = useCallback(
    (key: string) => {
      setGrid((prev) => {
        if (!(key in prev)) return prev;
        return { ...prev, [key]: paintMode };
      });
    },
    [paintMode],
  );

  const setAll = useCallback(
    (pref: Preference) => {
      setGrid((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          next[key] = pref;
        }
        return next;
      });
    },
    [],
  );

  const submitMutation = trpc.availability.submit.useMutation({
    onSuccess: () => {
      utils.availability.listForWeek.invalidate();
      toast.success(`Availability saved for ${staffName}`);
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const handleSave = () => {
    const slots: AvailabilitySlot[] = [];
    for (const date of weekDates) {
      for (const block of hourBlocks) {
        const key = cellKey(date, block.startTime);
        if (key in grid) {
          slots.push({
            day: date,
            startTime: block.startTime,
            endTime: block.endTime,
            preference: grid[key] ?? "unavailable",
          });
        }
      }
    }
    submitMutation.mutate({ staffId, weekStart, slots });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit Availability — {staffName}</DialogTitle>
          <DialogDescription>
            Click or drag to paint availability. Select a mode below, then paint cells.
          </DialogDescription>
        </DialogHeader>

        {/* Paint mode selector + bulk actions */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 rounded-lg border p-1">
            {(["unavailable", "available", "preferred"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setPaintMode(mode)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                  paintMode === mode
                    ? PAINT_BTN_STYLES[mode] + " ring-2 ring-ring"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {mode}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setAll("available")}>
              Set all available
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setAll("unavailable")}>
              Set all unavailable
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div
            className="grid gap-px min-w-[28rem] select-none"
            style={{
              gridTemplateColumns: `4rem repeat(${weekDates.length}, 1fr)`,
            }}
          >
            {/* Header row */}
            <div />
            {weekDates.map((date) => (
              <div
                key={date}
                className="text-center text-xs font-medium text-muted-foreground py-1"
              >
                {formatDayHeader(date)}
              </div>
            ))}

            {/* Hour block rows */}
            {hourBlocks.map((block) => (
              <React.Fragment key={block.startTime}>
                <div className="flex items-center pr-2 text-xs font-medium text-muted-foreground">
                  {block.label}
                </div>
                {weekDates.map((date) => {
                  const key = cellKey(date, block.startTime);
                  const valid = isCellInOperatingHours(date, block, operatingHours);
                  if (!valid) {
                    return <div key={key} className="h-8" />;
                  }
                  const pref = grid[key] ?? "unavailable";
                  return (
                    <div
                      key={key}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        setDragging(true);
                        paint(key);
                      }}
                      onPointerEnter={() => {
                        if (dragging) paint(key);
                      }}
                      className={cn(
                        "h-8 rounded-sm border cursor-pointer transition-colors touch-none",
                        CELL_STYLES[pref],
                      )}
                    />
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <span className={cn("inline-block h-3 w-3 rounded", CELL_STYLES.unavailable)} />
            Unavailable
          </div>
          <div className="flex items-center gap-1.5">
            <span className={cn("inline-block h-3 w-3 rounded", CELL_STYLES.available)} />
            Available
          </div>
          <div className="flex items-center gap-1.5">
            <span className={cn("inline-block h-3 w-3 rounded", CELL_STYLES.preferred)} />
            Preferred
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={submitMutation.isPending}
          >
            {submitMutation.isPending ? "Saving..." : "Save Availability"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
