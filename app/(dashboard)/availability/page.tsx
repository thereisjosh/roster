"use client";

import React, { useState, useEffect, useMemo } from "react";
import { trpc } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AvailabilityGridDialog } from "@/components/availability/availability-grid-dialog";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import {
  getWeekStart,
  getWeekDates,
  shiftWeek,
  formatWeekRange,
} from "@/lib/date-utils";
import { ChevronLeft, ChevronRight, Pencil, CalendarCheck } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";

const DAY_LABELS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parseTimeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export default function AvailabilityPage() {
  const { data: business } = trpc.business.getCurrent.useQuery();
  const { data: staffList } = trpc.staff.list.useQuery();

  const [currentWeekStart, setCurrentWeekStart] = useState<Date | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // Initialize week start once config loads
  useEffect(() => {
    if (business?.config && !currentWeekStart) {
      setCurrentWeekStart(getWeekStart(business.config.weekStartDay));
    }
  }, [business, currentWeekStart]);

  const { data: submissions } = trpc.availability.listForWeek.useQuery(
    { weekStart: currentWeekStart! },
    { enabled: !!currentWeekStart },
  );

  const config = business?.config;
  const weekDates = currentWeekStart ? getWeekDates(currentWeekStart) : [];
  // Derive hour blocks from operating hours for the When2Meet-style grid
  const hourBlocks = useMemo(() => {
    if (!config?.operatingHours) return [];
    let minH = 24, maxH = 0;
    for (const dayHours of Object.values(config.operatingHours)) {
      const open = parseTimeToMinutes(dayHours.open) / 60;
      const close = parseTimeToMinutes(dayHours.close) / 60;
      if (open < minH) minH = Math.floor(open);
      if (close > maxH) maxH = Math.ceil(close);
    }
    return Array.from({ length: maxH - minH }, (_, i) => {
      const h = minH + i;
      return {
        startTime: `${String(h).padStart(2, "0")}:00`,
        endTime: `${String(h + 1).padStart(2, "0")}:00`,
        label: `${String(h).padStart(2, "0")}:00`,
      };
    });
  }, [config?.operatingHours]);

  // Filter out closed days
  const openDates = useMemo(() => {
    if (!config?.closedDays || !weekDates.length) return weekDates;
    return weekDates.filter((date) => {
      const d = new Date(date + "T00:00:00Z");
      return !config.closedDays!.includes(d.getUTCDay());
    });
  }, [weekDates, config?.closedDays]);
  const hourRange = useMemo(() => {
    if (!config?.coverageRequirements?.length) return [];
    let minH = 24, maxH = 0;
    for (const req of config.coverageRequirements) {
      const s = parseTimeToMinutes(req.startTime) / 60;
      const e = parseTimeToMinutes(req.endTime) / 60;
      if (s < minH) minH = Math.floor(s);
      if (e > maxH) maxH = Math.ceil(e);
    }
    const hours: number[] = [];
    for (let h = minH; h < maxH; h++) hours.push(h);
    return hours;
  }, [config?.coverageRequirements]);

  const totalSlots = openDates.length * hourBlocks.length;

  const activeStaff = useMemo(
    () => staffList?.filter((s) => s.isActive) ?? [],
    [staffList],
  );

  // Map staffId → submission for quick lookup
  const submissionMap = useMemo(() => {
    const map = new Map<
      string,
      NonNullable<typeof submissions>[number]
    >();
    if (submissions) {
      for (const sub of submissions) {
        map.set(sub.staffId, sub);
      }
    }
    return map;
  }, [submissions]);

  // Coverage overview: count available staff per (day, hour)
  const coverageOverview = useMemo(() => {
    if (!weekDates.length || !hourRange.length || !submissions) return null;
    const counts: Record<string, number> = {};
    for (const date of weekDates) {
      for (const h of hourRange) {
        counts[`${date}|${h}`] = 0;
      }
    }
    for (const sub of submissions) {
      if (!sub.slots) continue;
      const slotsByDay = new Map<string, { startTime: string; endTime: string }[]>();
      for (const slot of sub.slots) {
        if (slot.preference === "unavailable") continue;
        const arr = slotsByDay.get(slot.day) ?? [];
        arr.push(slot);
        slotsByDay.set(slot.day, arr);
      }
      for (const [day, daySlots] of slotsByDay) {
        for (const h of hourRange) {
          const hMin = h * 60;
          const covered = daySlots.some((s) => {
            const sStart = parseTimeToMinutes(s.startTime);
            const sEnd = parseTimeToMinutes(s.endTime);
            return sStart <= hMin && sEnd >= hMin + 60;
          });
          if (covered) {
            const key = `${day}|${h}`;
            if (key in counts) counts[key]++;
          }
        }
      }
    }
    return counts;
  }, [weekDates, hourRange, submissions]);

  // Build a map of (hour, dayOfWeek) → minStaff from coverage requirements
  const requiredStaffMap = useMemo(() => {
    if (!config?.coverageRequirements) return new Map<string, number>();
    const map = new Map<string, number>();
    for (const req of config.coverageRequirements) {
      const startMin = parseTimeToMinutes(req.startTime);
      const endMin = parseTimeToMinutes(req.endTime);
      for (const day of req.days) {
        for (const h of hourRange) {
          const hMin = h * 60;
          if (startMin <= hMin && endMin >= hMin + 60) {
            const key = `${h}|${day}`;
            map.set(key, (map.get(key) ?? 0) + req.minStaff);
          }
        }
      }
    }
    return map;
  }, [config?.coverageRequirements, hourRange]);

  const groupedStaff = useMemo(() => {
    const notSubmitted: typeof activeStaff = [];
    const submitted: typeof activeStaff = [];
    const confirmed: typeof activeStaff = [];
    for (const s of activeStaff) {
      const sub = submissionMap.get(s.id);
      if (!sub) notSubmitted.push(s);
      else if (sub.status === "confirmed") confirmed.push(s);
      else submitted.push(s);
    }
    const sort = (a: typeof activeStaff) => a.sort((x, y) => x.name.localeCompare(y.name));
    return [
      { label: "Not Submitted", staff: sort(notSubmitted) },
      { label: "Submitted", staff: sort(submitted) },
      { label: "Confirmed", staff: sort(confirmed) },
    ].filter((g) => g.staff.length > 0);
  }, [activeStaff, submissionMap]);

  const handleEdit = (staff: { id: string; name: string }) => {
    setSelectedStaff(staff);
    setDialogOpen(true);
  };

  const handlePrev = () => {
    if (currentWeekStart) setCurrentWeekStart(shiftWeek(currentWeekStart, -1));
  };

  const handleNext = () => {
    if (currentWeekStart) setCurrentWeekStart(shiftWeek(currentWeekStart, 1));
  };

  function getStatusBadge(staffId: string) {
    const sub = submissionMap.get(staffId);
    if (!sub) {
      return <Badge variant="secondary">Not submitted</Badge>;
    }
    if (sub.status === "confirmed") {
      return <Badge variant="default">Confirmed</Badge>;
    }
    return <Badge variant="outline">Submitted</Badge>;
  }

  function getSlotsFilled(staffId: string): string {
    const sub = submissionMap.get(staffId);
    if (!sub || !sub.slots) return `0/${totalSlots}`;
    const filled = sub.slots.filter(
      (s) => s.preference !== "unavailable",
    ).length;
    return `${filled}/${totalSlots}`;
  }

  const selectedSubmission = selectedStaff
    ? submissionMap.get(selectedStaff.id)
    : undefined;

  if (!config || !currentWeekStart) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Availability</h1>
        <p className="text-muted-foreground mt-1">Track and manage staff availability for each week.</p>
        <div className="space-y-3">
          <Skeleton className="h-10 w-64" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Availability</h1>
          <p className="text-muted-foreground mt-1">Track and manage staff availability for each week.</p>
        </div>
      </div>

      {/* Week navigation */}
      <div className="flex items-center gap-3">
        <Button variant="outline" size="icon" onClick={handlePrev} aria-label="Previous week">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium">
          {formatWeekRange(currentWeekStart)}
        </span>
        <Button variant="outline" size="icon" onClick={handleNext} aria-label="Next week">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Coverage overview heatmap */}
      {coverageOverview && hourRange.length > 0 && weekDates.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Coverage Overview</h3>
          <div className="overflow-x-auto">
            <div className="inline-grid gap-1 text-xs" style={{ gridTemplateColumns: `3.5rem repeat(${hourRange.length}, 1fr)` }}>
              {/* Header: hour labels on X-axis */}
              <div />
              {hourRange.map((h) => (
                <div key={h} className="text-center font-medium text-muted-foreground min-w-[2.5rem]">
                  {String(h).padStart(2, "0")}:00
                </div>
              ))}
              {/* Rows: one per day */}
              {weekDates.map((date) => {
                const d = new Date(date + "T00:00:00Z");
                const dayNum = d.getUTCDay();
                return (
                  <React.Fragment key={`row-${date}`}>
                    <div className="flex items-center pr-2 font-medium">
                      {DAY_LABELS_SHORT[dayNum]}
                    </div>
                    {hourRange.map((h) => {
                      const available = coverageOverview[`${date}|${h}`] ?? 0;
                      const required = requiredStaffMap.get(`${h}|${dayNum}`) ?? 0;
                      let colorClass = "bg-muted text-muted-foreground";
                      if (required > 0) {
                        if (available >= required) {
                          colorClass = "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
                        } else if (available > 0) {
                          colorClass = "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400";
                        } else {
                          colorClass = "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
                        }
                      }
                      return (
                        <div
                          key={`${date}|${h}`}
                          className={`rounded px-1 py-1.5 text-center font-medium ${colorClass}`}
                        >
                          {available}/{required}
                        </div>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Staff table */}
      {!activeStaff.length ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <CalendarCheck className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="text-muted-foreground mb-2">
            No active staff members.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/staff">Add staff members</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {groupedStaff.map((group) => (
            <CollapsibleSection
              key={group.label}
              title={group.label}
              description={`${group.staff.length} staff member${group.staff.length !== 1 ? "s" : ""}`}
              defaultOpen={group.label === "Not Submitted"}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Staff Member</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Slots Filled</TableHead>
                    <TableHead className="w-24">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.staff.map((member) => (
                    <TableRow key={member.id}>
                      <TableCell className="font-medium">{member.name}</TableCell>
                      <TableCell>{getStatusBadge(member.id)}</TableCell>
                      <TableCell>{getSlotsFilled(member.id)}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit availability for ${member.name}`}
                          onClick={() =>
                            handleEdit({ id: member.id, name: member.name })
                          }
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CollapsibleSection>
          ))}
        </div>
      )}

      {selectedStaff && (
        <AvailabilityGridDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          staffId={selectedStaff.id}
          staffName={selectedStaff.name}
          weekStart={currentWeekStart}
          weekDates={openDates}
          hourBlocks={hourBlocks}
          operatingHours={config.operatingHours ?? {}}
          existingSlots={selectedSubmission?.slots ?? []}
        />
      )}
    </div>
  );
}
