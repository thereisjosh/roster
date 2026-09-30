"use client";

import { useRef, useCallback } from "react";
import type { BusinessConfig } from "@/lib/db/schema";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { CollapsibleSection } from "@/components/ui/collapsible-section";

interface Props {
  config: BusinessConfig;
  onChange: (config: BusinessConfig) => void;
}

function getSummary(config: BusinessConfig): string {
  const rules = config.breakRules ?? [];
  const deduction = config.breakDeduction ?? { enabled: false };
  return `${rules.length} rule${rules.length !== 1 ? "s" : ""} · deduction ${deduction.enabled ? "on" : "off"}`;
}

export function BreakRulesSection({ config, onChange }: Props) {
  const rules = config.breakRules ?? [];
  const deduction = config.breakDeduction ?? { enabled: false, appliesTo: "both" as const };
  const deletedRuleRef = useRef<{ index: number; rule: (typeof rules)[number] } | null>(null);

  const updateRule = (index: number, field: "name" | "durationMinutes", value: string | number) => {
    const updated = rules.map((r, i) =>
      i === index ? { ...r, [field]: field === "durationMinutes" ? Number(value) || 0 : value } : r,
    );
    onChange({ ...config, breakRules: updated });
  };

  const addRule = () => {
    onChange({ ...config, breakRules: [...rules, { name: "", durationMinutes: 30 }] });
  };

  const removeRule = useCallback((index: number) => {
    const removed = rules[index];
    deletedRuleRef.current = { index, rule: removed };
    const updated = rules.filter((_, i) => i !== index);
    onChange({ ...config, breakRules: updated });
    toast("Break rule removed", {
      action: {
        label: "Undo",
        onClick: () => {
          if (deletedRuleRef.current) {
            const { index: idx, rule } = deletedRuleRef.current;
            const restored = [...updated];
            restored.splice(idx, 0, rule);
            onChange({ ...config, breakRules: restored });
            deletedRuleRef.current = null;
          }
        },
      },
      duration: 5000,
    });
  }, [config, onChange, rules]);

  return (
    <CollapsibleSection
      title="Breaks"
      description="Define break types and whether break time is deducted from total hours."
      summary={getSummary(config)}
    >
      <div className="space-y-4">
        {rules.map((rule, i) => (
          <div key={i} className="flex items-end gap-3">
            <div className="flex-1 space-y-1">
              <Label>Name</Label>
              <Input
                value={rule.name}
                onChange={(e) => updateRule(i, "name", e.target.value)}
                placeholder="e.g. Lunch"
              />
            </div>
            <div className="w-32 space-y-1">
              <Label>Duration (min)</Label>
              <Input
                type="number"
                min={0}
                value={rule.durationMinutes}
                onChange={(e) => updateRule(i, "durationMinutes", e.target.value)}
              />
            </div>
            <Button variant="ghost" size="icon" aria-label="Remove break rule" onClick={() => removeRule(i)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={addRule}>
          Add Break Rule
        </Button>
      </div>

      <div className="space-y-4 border-t pt-4">
        <div className="flex items-center gap-3">
          <Switch
            id="break-deduction"
            checked={deduction.enabled}
            onCheckedChange={(checked) =>
              onChange({ ...config, breakDeduction: { ...deduction, enabled: checked } })
            }
          />
          <Label htmlFor="break-deduction">Deduct break hours from total hours</Label>
        </div>

        {deduction.enabled && (
          <div className="space-y-2 pl-12">
            <Label>Applies to</Label>
            <Select
              value={deduction.appliesTo}
              onValueChange={(v) =>
                onChange({
                  ...config,
                  breakDeduction: { ...deduction, appliesTo: v as "full-time" | "part-time" | "both" },
                })
              }
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full-time">Full-time only</SelectItem>
                <SelectItem value="part-time">Part-time only</SelectItem>
                <SelectItem value="both">Both</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}
