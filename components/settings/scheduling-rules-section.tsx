"use client";

import type { BusinessConfig } from "@/lib/db/schema";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CollapsibleSection } from "@/components/ui/collapsible-section";

const DAYS = [
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
];

interface Props {
  config: BusinessConfig;
  onChange: (config: BusinessConfig) => void;
}

function getSummary(config: BusinessConfig): string {
  const rest = config.minRestHoursBetweenShifts;
  const minShift = config.minShiftHours ?? 3;
  return `Max ${config.maxConsecutiveDays} days · ${rest}h rest · ${minShift}h min`;
}

function getFullTimeWarnings(config: BusinessConfig): string[] {
  const ft = config.fullTimeHours ?? { min: 35, target: 40, max: 44 };
  const warnings: string[] = [];
  if (ft.min > ft.target) warnings.push("Min should not exceed target");
  if (ft.target > ft.max) warnings.push("Target should not exceed max");
  return warnings;
}

export function SchedulingRulesSection({ config, onChange }: Props) {
  const ftWarnings = getFullTimeWarnings(config);

  return (
    <CollapsibleSection
      title="Scheduling Rules"
      description="Constraints for shift length, rest periods, and weekly hours."
      summary={getSummary(config)}
      defaultOpen
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Week start day</Label>
          <Select
            value={String(config.weekStartDay)}
            onValueChange={(v) =>
              onChange({ ...config, weekStartDay: Number(v) })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DAYS.map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="maxConsecutiveDays">Max days in a row</Label>
          <Input
            id="maxConsecutiveDays"
            type="number"
            min={1}
            max={7}
            value={config.maxConsecutiveDays}
            onChange={(e) =>
              onChange({
                ...config,
                maxConsecutiveDays: Number(e.target.value) || 1,
              })
            }
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="minRest">Rest between shifts</Label>
          <Input
            id="minRest"
            type="number"
            min={0}
            max={24}
            value={config.minRestHoursBetweenShifts}
            onChange={(e) =>
              onChange({
                ...config,
                minRestHoursBetweenShifts: Number(e.target.value) || 0,
              })
            }
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="minShiftHours">Minimum shift length</Label>
          <Input
            id="minShiftHours"
            type="number"
            min={1}
            max={12}
            value={config.minShiftHours ?? 3}
            onChange={(e) =>
              onChange({
                ...config,
                minShiftHours: Number(e.target.value) || 1,
              })
            }
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Full-time weekly hours</Label>
        <div className="flex items-center gap-2">
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Min</span>
            <Input
              type="number"
              min={0}
              max={168}
              value={(config.fullTimeHours ?? { min: 35, target: 40, max: 44 }).min}
              onChange={(e) =>
                onChange({
                  ...config,
                  fullTimeHours: {
                    ...(config.fullTimeHours ?? { min: 35, target: 40, max: 44 }),
                    min: Number(e.target.value) || 0,
                  },
                })
              }
              className={`w-20 ${ftWarnings.includes("Min should not exceed target") ? "ring-1 ring-destructive" : ""}`}
            />
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Target</span>
            <Input
              type="number"
              min={0}
              max={168}
              value={(config.fullTimeHours ?? { min: 35, target: 40, max: 44 }).target}
              onChange={(e) =>
                onChange({
                  ...config,
                  fullTimeHours: {
                    ...(config.fullTimeHours ?? { min: 35, target: 40, max: 44 }),
                    target: Number(e.target.value) || 0,
                  },
                })
              }
              className={`w-20 ${ftWarnings.some((w) => w.includes("target")) ? "ring-1 ring-destructive" : ""}`}
            />
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Max</span>
            <Input
              type="number"
              min={0}
              max={168}
              value={(config.fullTimeHours ?? { min: 35, target: 40, max: 44 }).max}
              onChange={(e) =>
                onChange({
                  ...config,
                  fullTimeHours: {
                    ...(config.fullTimeHours ?? { min: 35, target: 40, max: 44 }),
                    max: Number(e.target.value) || 0,
                  },
                })
              }
              className={`w-20 ${ftWarnings.includes("Target should not exceed max") ? "ring-1 ring-destructive" : ""}`}
            />
          </div>
        </div>
        {ftWarnings.map((w, i) => (
          <p key={i} className="text-xs text-destructive">{w}</p>
        ))}
      </div>
    </CollapsibleSection>
  );
}
