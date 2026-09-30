"use client";

import type { BusinessConfig } from "@/lib/db/schema";
import { Label } from "@/components/ui/label";
import { CollapsibleSection } from "@/components/ui/collapsible-section";

interface Props {
  config: BusinessConfig;
  onChange: (config: BusinessConfig) => void;
}

const WEIGHTS = [
  { key: "costWeight" as const, label: "Minimize labor cost" },
  { key: "fairnessWeight" as const, label: "Distribute hours evenly" },
  { key: "preferenceWeight" as const, label: "Respect staff preferences" },
];

function getSummary(config: BusinessConfig): string {
  return `Cost ${Math.round(config.costWeight * 100)}% · Fair ${Math.round(config.fairnessWeight * 100)}% · Pref ${Math.round(config.preferenceWeight * 100)}%`;
}

export function SchedulingWeightsSection({ config, onChange }: Props) {
  const sum = +(
    config.costWeight +
    config.fairnessWeight +
    config.preferenceWeight
  ).toFixed(2);

  const handleSliderChange = (key: "costWeight" | "fairnessWeight" | "preferenceWeight", rawValue: number) => {
    const value = Math.round(rawValue) / 100;
    onChange({ ...config, [key]: parseFloat(value.toFixed(2)) });
  };

  return (
    <CollapsibleSection
      title="Scheduling priorities"
      description="Fine-tune how the algorithm balances cost, fairness, and preferences."
      summary={getSummary(config)}
    >
      {WEIGHTS.map(({ key, label }) => (
        <div key={key} className="space-y-1">
          <div className="flex items-center justify-between">
            <Label>{label}</Label>
            <span className="text-sm tabular-nums text-muted-foreground">{Math.round(config[key] * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(config[key] * 100)}
            onChange={(e) => handleSliderChange(key, Number(e.target.value))}
            className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-muted accent-primary"
          />
        </div>
      ))}

      <p
        className={`text-sm font-medium ${
          sum === 1 ? "text-muted-foreground" : "text-destructive"
        }`}
      >
        Total: {Math.round(sum * 100)}%
        {sum !== 1 && " — should total 100%"}
      </p>
    </CollapsibleSection>
  );
}
