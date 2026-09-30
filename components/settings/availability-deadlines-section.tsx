"use client";

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
import { Plus, X } from "lucide-react";
import { useRef, useCallback } from "react";
import { toast } from "sonner";
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

const DAY_ABBREV = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const HOURS = Array.from({ length: 24 }, (_, i) => ({
  value: String(i),
  label: `${String(i).padStart(2, "0")}:00`,
}));

interface Props {
  config: BusinessConfig;
  onChange: (config: BusinessConfig) => void;
}

function getSummary(config: BusinessConfig): string {
  const day = DAY_ABBREV[config.availabilityDeadlineDay] ?? "Wed";
  const hour = `${String(config.availabilityDeadlineHour).padStart(2, "0")}:00`;
  const reminders = config.reminderIntervals.length;
  return `${day} ${hour} · ${reminders} reminder${reminders !== 1 ? "s" : ""}`;
}

export function AvailabilityDeadlinesSection({ config, onChange }: Props) {
  const deletedReminderRef = useRef<{ index: number; value: number } | null>(null);

  const addReminder = () => {
    onChange({
      ...config,
      reminderIntervals: [...config.reminderIntervals, 12],
    });
  };

  const removeReminder = useCallback((index: number) => {
    const removed = config.reminderIntervals[index];
    deletedReminderRef.current = { index, value: removed };
    const updated = config.reminderIntervals.filter((_, i) => i !== index);
    onChange({ ...config, reminderIntervals: updated });
    toast("Reminder removed", {
      action: {
        label: "Undo",
        onClick: () => {
          if (deletedReminderRef.current) {
            const { index: idx, value } = deletedReminderRef.current;
            const restored = [...updated];
            restored.splice(idx, 0, value);
            onChange({ ...config, reminderIntervals: restored });
            deletedReminderRef.current = null;
          }
        },
      },
      duration: 5000,
    });
  }, [config, onChange]);

  const updateReminder = (index: number, value: number) => {
    const updated = [...config.reminderIntervals];
    updated[index] = value;
    onChange({ ...config, reminderIntervals: updated });
  };

  return (
    <CollapsibleSection
      title="Availability Deadline"
      description="When staff must submit their availability each week."
      summary={getSummary(config)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Deadline day</Label>
          <Select
            value={String(config.availabilityDeadlineDay)}
            onValueChange={(v) =>
              onChange({ ...config, availabilityDeadlineDay: Number(v) })
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
          <Label>Deadline hour</Label>
          <Select
            value={String(config.availabilityDeadlineHour)}
            onValueChange={(v) =>
              onChange({ ...config, availabilityDeadlineHour: Number(v) })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HOURS.map((h) => (
                <SelectItem key={h.value} value={h.value}>
                  {h.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Send reminders</Label>
          <Button type="button" variant="outline" size="sm" onClick={addReminder}>
            <Plus className="mr-1 h-3 w-3" />
            Add
          </Button>
        </div>
        <div className="space-y-2">
          {config.reminderIntervals.map((interval, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="relative">
                <Input
                  type="number"
                  min={1}
                  value={interval}
                  onChange={(e) => updateReminder(i, Number(e.target.value) || 1)}
                  className="w-28 pr-12"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">hrs</span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remove reminder"
                onClick={() => removeReminder(i)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {config.reminderIntervals.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No reminders configured.
            </p>
          )}
        </div>
      </div>
    </CollapsibleSection>
  );
}
