"use client";

import { useRef, useCallback, useState } from "react";
import type { BusinessConfig } from "@/lib/db/schema";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, X, Pencil } from "lucide-react";
import { DayToggleGroup } from "@/components/ui/day-toggle-group";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { toast } from "sonner";

interface Props {
  config: BusinessConfig;
  onChange: (config: BusinessConfig) => void;
  roles: string[];
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_ABBREV = ["S", "M", "T", "W", "T", "F", "S"];

function formatDaysAbbrev(days: number[], closedDays: Set<number>): string {
  return DAY_ABBREV.map((letter, i) =>
    closedDays.has(i) ? "" : days.includes(i) ? letter : "·"
  )
    .filter(Boolean)
    .join(" ");
}

function getOperatingHoursSummary(config: BusinessConfig): string {
  const closedDays = new Set(config.closedDays ?? []);
  const openDayIndices = [];
  for (let d = 0; d < 7; d++) {
    if (!closedDays.has(d)) openDayIndices.push(d);
  }
  if (openDayIndices.length === 0) return "All days closed";

  // Check if all open days have same hours
  const hours = openDayIndices.map(
    (d) => config.operatingHours?.[String(d)] ?? { open: "09:00", close: "17:00" }
  );
  const allSame = hours.every(
    (h) => h.open === hours[0].open && h.close === hours[0].close
  );

  const dayRange = (() => {
    if (openDayIndices.length === 7) return "Every day";
    // Check for contiguous range
    const labels = openDayIndices.map((d) => DAY_LABELS[d]);
    if (labels.length <= 2) return labels.join(", ");
    return `${labels[0]}–${labels[labels.length - 1]}`;
  })();

  if (allSame) {
    return `${dayRange} · ${hours[0].open}–${hours[0].close}`;
  }
  return `${dayRange} · varies`;
}

function getCoverageSummary(config: BusinessConfig): string {
  const count = config.coverageRequirements.length;
  return `${count} requirement${count !== 1 ? "s" : ""}`;
}

export function ShiftTypesSection({ config, onChange, roles }: Props) {
  const closedDays = new Set(config.closedDays ?? []);
  const deletedReqRef = useRef<{ index: number; req: BusinessConfig["coverageRequirements"][number] } | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const updateDayHours = (day: number, field: "open" | "close", value: string) => {
    const key = String(day);
    const existing = config.operatingHours?.[key] ?? { open: "09:00", close: "17:00" };
    onChange({
      ...config,
      operatingHours: {
        ...config.operatingHours,
        [key]: { ...existing, [field]: value },
      },
    });
  };

  const handleClosedDaysChange = (newClosedDaysList: number[]) => {
    const newClosedSet = new Set(newClosedDaysList);
    const newHours = { ...config.operatingHours };

    for (let d = 0; d < 7; d++) {
      const key = String(d);
      if (newClosedSet.has(d)) {
        delete newHours[key];
      } else if (closedDays.has(d) && !newClosedSet.has(d)) {
        newHours[key] = { open: "09:00", close: "17:00" };
      }
    }

    const newCoverage = config.coverageRequirements.map((req) => ({
      ...req,
      days: req.days.filter((d) => !newClosedSet.has(d)),
    }));

    onChange({
      ...config,
      closedDays: newClosedDaysList,
      operatingHours: newHours,
      coverageRequirements: newCoverage,
    });
  };

  const addRequirement = () => {
    const newIndex = config.coverageRequirements.length;
    onChange({
      ...config,
      coverageRequirements: [
        ...config.coverageRequirements,
        { role: "", days: [1, 2, 3, 4, 5].filter((d) => !closedDays.has(d)), startTime: "09:00", endTime: "17:00", minStaff: 1 },
      ],
    });
    setEditingIndex(newIndex);
  };

  const removeRequirement = useCallback((index: number) => {
    const removed = config.coverageRequirements[index];
    deletedReqRef.current = { index, req: removed };
    const updated = config.coverageRequirements.filter((_, i) => i !== index);
    onChange({ ...config, coverageRequirements: updated });
    if (editingIndex === index) setEditingIndex(null);
    else if (editingIndex !== null && editingIndex > index) setEditingIndex(editingIndex - 1);
    toast("Coverage requirement removed", {
      action: {
        label: "Undo",
        onClick: () => {
          if (deletedReqRef.current) {
            const { index: idx, req } = deletedReqRef.current;
            const restored = [...updated];
            restored.splice(idx, 0, req);
            onChange({ ...config, coverageRequirements: restored });
            deletedReqRef.current = null;
          }
        },
      },
      duration: 5000,
    });
  }, [config, onChange, editingIndex]);

  const updateRequirement = (
    index: number,
    field: string,
    value: string | number | number[],
  ) => {
    const updated = [...config.coverageRequirements];
    updated[index] = { ...updated[index], [field]: value };
    onChange({ ...config, coverageRequirements: updated });
  };

  const openDays = DAY_LABELS.map((label, day) => ({ label, day })).filter(
    ({ day }) => !closedDays.has(day),
  );

  // Validation helpers
  const getHoursWarning = (day: number): string | null => {
    const hours = config.operatingHours?.[String(day)];
    if (hours && hours.close <= hours.open) return "Close must be after open";
    return null;
  };

  const getCoverageWarnings = (req: BusinessConfig["coverageRequirements"][number]): string[] => {
    const warnings: string[] = [];
    if (req.days.length === 0) warnings.push("Select at least one day");
    if (req.maxStaff != null && req.maxStaff < req.minStaff) warnings.push("Max must be ≥ min");
    return warnings;
  };

  return (
    <div className="space-y-4">
      {/* Operating Hours */}
      <CollapsibleSection
        title="Operating Hours"
        description="Set open and close times for each day."
        summary={getOperatingHoursSummary(config)}
        defaultOpen
      >
        {openDays.length > 0 && (
          <>
            <div className="grid grid-cols-[4rem_5.5rem_5.5rem] gap-x-2 gap-y-2 items-center text-xs font-medium text-muted-foreground">
              <span>Day</span>
              <span>Open</span>
              <span>Close</span>
            </div>
            <div className="space-y-2">
              {openDays.map(({ label, day }) => {
                const hours = config.operatingHours?.[String(day)];
                const warning = getHoursWarning(day);
                return (
                  <div key={day}>
                    <div className="grid grid-cols-[4rem_5.5rem_5.5rem] gap-x-2 items-center">
                      <span id={`day-label-${day}`} className="text-sm font-medium">{label}</span>
                      <Input
                        type="time"
                        value={hours?.open ?? ""}
                        onChange={(e) => updateDayHours(day, "open", e.target.value)}
                        aria-labelledby={`day-label-${day}`}
                      />
                      <Input
                        type="time"
                        value={hours?.close ?? ""}
                        onChange={(e) => updateDayHours(day, "close", e.target.value)}
                        aria-labelledby={`day-label-${day}`}
                        className={warning ? "ring-1 ring-destructive" : ""}
                      />
                    </div>
                    {warning && (
                      <p className="text-xs text-destructive mt-1 ml-[4.5rem]">{warning}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
        {openDays.length === 0 && (
          <p className="text-sm text-muted-foreground">All days are closed. Toggle days below to set hours.</p>
        )}
        <div className="space-y-2 pt-2 border-t">
          <Label>Closed days</Label>
          <DayToggleGroup
            selected={config.closedDays ?? []}
            onChange={handleClosedDaysChange}
          />
        </div>
      </CollapsibleSection>

      {/* Coverage Requirements */}
      <CollapsibleSection
        title="Coverage Requirements"
        description="Define how many staff are needed for each role and time window."
        summary={getCoverageSummary(config)}
      >
        <div className="flex items-center justify-end">
          <Button type="button" variant="outline" size="sm" onClick={addRequirement}>
            <Plus className="mr-1 h-3 w-3" />
            Add
          </Button>
        </div>

        {config.coverageRequirements.length > 0 && (
          <div className="space-y-2">
            {/* Compact table header */}
            <div className="hidden sm:grid grid-cols-[1fr_6rem_6rem_3rem_4rem] gap-2 text-xs font-medium text-muted-foreground px-1">
              <span>Role</span>
              <span>Time</span>
              <span>Staff</span>
              <span>Days</span>
              <span></span>
            </div>

            {config.coverageRequirements.map((req, i) => {
              const warnings = getCoverageWarnings(req);
              const isEditing = editingIndex === i;

              if (!isEditing) {
                // Compact row view
                return (
                  <div
                    key={i}
                    role="group"
                    aria-label={`Coverage requirement ${i + 1}`}
                    className="rounded-lg border p-2 sm:p-1"
                  >
                    <div className="hidden sm:grid grid-cols-[1fr_6rem_6rem_3rem_4rem] gap-2 items-center px-1">
                      <span className="text-sm truncate">{req.role || "Any"}</span>
                      <span className="text-sm text-muted-foreground">{req.startTime}–{req.endTime}</span>
                      <span className="text-sm text-muted-foreground">
                        {req.maxStaff != null ? `${req.minStaff}–${req.maxStaff}` : `${req.minStaff}+`}
                      </span>
                      <span className="text-xs text-muted-foreground font-mono tracking-tight">
                        {formatDaysAbbrev(req.days, closedDays)}
                      </span>
                      <div className="flex gap-1 justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label="Edit coverage requirement"
                          onClick={() => setEditingIndex(i)}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label="Remove coverage requirement"
                          onClick={() => removeRequirement(i)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    {/* Mobile compact view */}
                    <div className="sm:hidden flex items-center justify-between">
                      <div className="text-sm">
                        <span className="font-medium">{req.role || "Any"}</span>
                        <span className="text-muted-foreground"> · {req.startTime}–{req.endTime} · {req.minStaff}{req.maxStaff != null ? `–${req.maxStaff}` : "+"} staff</span>
                      </div>
                      <div className="flex gap-1">
                        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="Edit" onClick={() => setEditingIndex(i)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="Remove" onClick={() => removeRequirement(i)}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    {warnings.length > 0 && (
                      <div className="px-1 pt-1">
                        {warnings.map((w, wi) => (
                          <p key={wi} className="text-xs text-destructive">{w}</p>
                        ))}
                      </div>
                    )}
                  </div>
                );
              }

              // Expanded edit view
              return (
                <div
                  key={i}
                  role="group"
                  aria-label={`Coverage requirement ${i + 1}`}
                  className="rounded-lg border p-3 space-y-3 ring-1 ring-primary/20"
                >
                  <div className="flex items-center justify-between">
                    <Select
                      value={req.role || "__any__"}
                      onValueChange={(v) => updateRequirement(i, "role", v === "__any__" ? "" : v)}
                      disabled={roles.length === 0}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={roles.length === 0 ? "Add roles to staff first" : "Any role"} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__any__">Any role</SelectItem>
                        {roles.map((role) => (
                          <SelectItem key={role} value={role}>
                            {role}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 ml-2 shrink-0"
                      aria-label="Remove coverage requirement"
                      onClick={() => removeRequirement(i)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <DayToggleGroup
                    selected={req.days}
                    onChange={(days) => updateRequirement(i, "days", days)}
                    disabled={closedDays}
                  />
                  {warnings.includes("Select at least one day") && (
                    <p className="text-xs text-destructive">Select at least one day</p>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">Start</span>
                      <Input
                        type="time"
                        value={req.startTime}
                        onChange={(e) => updateRequirement(i, "startTime", e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">End</span>
                      <Input
                        type="time"
                        value={req.endTime}
                        onChange={(e) => updateRequirement(i, "endTime", e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">Min staff</span>
                      <Input
                        type="number"
                        min={1}
                        value={req.minStaff}
                        onChange={(e) => updateRequirement(i, "minStaff", Number(e.target.value) || 1)}
                      />
                    </div>
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">Max staff</span>
                      <Input
                        type="number"
                        min={1}
                        value={req.maxStaff ?? ""}
                        onChange={(e) =>
                          updateRequirement(
                            i,
                            "maxStaff",
                            e.target.value === "" ? undefined as unknown as number : Number(e.target.value) || 1,
                          )
                        }
                        placeholder="—"
                        className={warnings.includes("Max must be ≥ min") ? "ring-1 ring-destructive" : ""}
                      />
                    </div>
                  </div>
                  {warnings.includes("Max must be ≥ min") && (
                    <p className="text-xs text-destructive">Max must be ≥ min</p>
                  )}
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setEditingIndex(null)}
                    >
                      Done
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {config.coverageRequirements.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No coverage requirements configured. Add at least one.
          </p>
        )}
      </CollapsibleSection>
    </div>
  );
}
