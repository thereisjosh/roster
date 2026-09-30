"use client";

import { cn } from "@/lib/utils";
import { Star } from "lucide-react";
import type { ShiftAssignment } from "@/lib/db/schema";
import { parseWarnings, summarizeWarnings } from "@/lib/scheduling/parse-warnings";

interface Variation {
  id: string;
  variationType: string;
  assignments: ShiftAssignment[];
  totalCost: number | null;
  coverageWarnings: string | null;
  approvedAt: Date | null;
}

interface VariationComparisonProps {
  variations: Variation[];
}

function formatVariationType(type: string) {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function getCoverage(assignments: ShiftAssignment[]) {
  const filled = new Set(
    assignments.map((a) => `${a.day}|${a.shiftType}`),
  ).size;
  return filled;
}

export function VariationComparison({ variations }: VariationComparisonProps) {
  const costs = variations.map((v) => v.totalCost ?? 0);
  const coverages = variations.map((v) => getCoverage(v.assignments));
  const minCost = Math.min(...costs);
  const maxCoverage = Math.max(...coverages);

  return (
    <div
      className="grid gap-x-4 gap-y-2 text-sm"
      style={{ gridTemplateColumns: `auto repeat(${variations.length}, 1fr)` }}
    >
      {/* Header row */}
      <div />
      {variations.map((v) => (
        <div
          key={v.id}
          className={cn(
            "text-center font-medium px-3 py-2 rounded-t-md",
            v.approvedAt && "bg-primary/5 border border-b-0 border-primary/20",
          )}
        >
          {formatVariationType(v.variationType)}
        </div>
      ))}

      {/* Total Cost row */}
      <div className="font-medium text-muted-foreground py-1">Total Cost</div>
      {variations.map((v, i) => (
        <div
          key={v.id}
          className={cn(
            "text-center py-1",
            v.approvedAt && "bg-primary/5 border-x border-primary/20 px-3",
          )}
        >
          ${costs[i].toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          {costs[i] === minCost && costs[i] > 0 && (
            <Star className="inline ml-1 h-3 w-3 text-yellow-500 fill-yellow-500" />
          )}
        </div>
      ))}

      {/* Coverage row */}
      <div className="font-medium text-muted-foreground py-1">Shifts Filled</div>
      {variations.map((v, i) => (
        <div
          key={v.id}
          className={cn(
            "text-center py-1",
            v.approvedAt && "bg-primary/5 border-x border-primary/20 px-3",
          )}
        >
          {coverages[i]} shifts
          {coverages[i] === maxCoverage && coverages[i] > 0 && (
            <Star className="inline ml-1 h-3 w-3 text-yellow-500 fill-yellow-500" />
          )}
        </div>
      ))}

      {/* Warnings row (only if any variation has warnings) */}
      {variations.some((v) => v.coverageWarnings) && (
        <>
          <div className="font-medium text-muted-foreground py-1">Issues</div>
          {variations.map((v) => {
            const summary = summarizeWarnings(parseWarnings(v.coverageWarnings));
            const hasAny = summary.errors + summary.warnings > 0;
            return (
              <div
                key={v.id}
                className={cn(
                  "text-center py-1 text-xs",
                  v.approvedAt && "bg-primary/5 border-x border-b border-primary/20 rounded-b-md px-3",
                )}
              >
                {!hasAny ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    {summary.errors > 0 && (
                      <span className="inline-flex items-center gap-1 text-red-600">
                        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                        {summary.errors} {summary.errors === 1 ? "issue" : "issues"}
                      </span>
                    )}
                    {summary.warnings > 0 && (
                      <span className="inline-flex items-center gap-1 text-amber-600">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        {summary.warnings}
                      </span>
                    )}
                  </span>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
