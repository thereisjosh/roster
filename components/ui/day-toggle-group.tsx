"use client";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface DayToggleGroupProps {
  selected: number[];
  onChange: (days: number[]) => void;
  disabled?: Set<number>;
}

export function DayToggleGroup({ selected, onChange, disabled }: DayToggleGroupProps) {
  const toggle = (day: number) => {
    const next = selected.includes(day)
      ? selected.filter((d) => d !== day)
      : [...selected, day].sort((a, b) => a - b);
    onChange(next);
  };

  return (
    <div className="flex gap-1">
      {DAY_LABELS.map((label, day) => {
        const isDisabled = disabled?.has(day);
        const isSelected = selected.includes(day);
        return (
          <button
            key={day}
            type="button"
            role="checkbox"
            aria-checked={isSelected}
            aria-label={DAY_FULL[day]}
            disabled={isDisabled}
            onClick={() => toggle(day)}
            className={`h-8 rounded-md px-2.5 text-xs font-medium transition-colors ${
              isDisabled
                ? "cursor-not-allowed opacity-30 line-through"
                : isSelected
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
