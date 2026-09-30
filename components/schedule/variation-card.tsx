"use client";

import { cn } from "@/lib/utils";
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
import { Check, AlertTriangle, Activity, CircleCheck, CircleAlert, CircleX } from "lucide-react";
import { WarningPanel } from "@/components/schedule/warning-panel";
import type { ShiftAssignment } from "@/lib/db/schema";
import { trpc } from "@/lib/trpc/client";

interface Variation {
  id: string;
  variationType: string;
  assignments: ShiftAssignment[];
  totalCost: number | null;
  coverageWarnings: string | null;
  approvedAt: Date | null;
}

interface VariationCardProps {
  variation: Variation;
  runStatus: string;
  onApprove: () => void;
  isApproving: boolean;
  showScore?: boolean;
}

const DAY_ORDER: Record<string, number> = {
  "0": 0, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6,
  Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
  Monday: 0, Tuesday: 1, Wednesday: 2, Thursday: 3, Friday: 4, Saturday: 5, Sunday: 6,
};

function daySort(day: string): number {
  // If it's an ISO date string, parse to get the weekday
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const d = new Date(day + "T00:00:00Z");
    // Convert JS day (0=Sun) to Mon-first (0=Mon)
    return (d.getUTCDay() + 6) % 7;
  }
  return DAY_ORDER[day] ?? 99;
}

function formatDayName(day: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const d = new Date(day + "T00:00:00Z");
    return d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  }
  return day.slice(0, 3);
}

function formatVariationType(type: string) {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function sortAssignments(assignments: ShiftAssignment[]) {
  return [...assignments].sort((a, b) => {
    const dayDiff = daySort(a.day) - daySort(b.day);
    if (dayDiff !== 0) return dayDiff;
    const shiftDiff = a.shiftType.localeCompare(b.shiftType);
    if (shiftDiff !== 0) return shiftDiff;
    return a.staffName.localeCompare(b.staffName);
  });
}

function scoreColor(score: number): { className: string; Icon: typeof CircleCheck } {
  if (score >= 0.8) return { className: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200", Icon: CircleCheck };
  if (score >= 0.55) return { className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200", Icon: CircleAlert };
  return { className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200", Icon: CircleX };
}

export function VariationCard({
  variation,
  runStatus,
  onApprove,
  isApproving,
  showScore = true,
}: VariationCardProps) {
  const { data: scoreResult, isLoading: scoreLoading } =
    trpc.schedule.scoreVariation.useQuery(
      { variationId: variation.id },
      { enabled: showScore },
    );

  const sorted = sortAssignments(variation.assignments);
  const coverage = new Set(
    variation.assignments.map((a) => `${a.day}|${a.shiftType}`),
  ).size;
  const isApproved = !!variation.approvedAt;
  const canApprove = runStatus === "pending_review" && !isApproved;

  // Track which day group we're in for alternating backgrounds
  let lastDay = "";
  let dayGroupIndex = 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Badge variant="outline">
            {formatVariationType(variation.variationType)}
          </Badge>
          <span className="text-sm text-muted-foreground">
            Total: ${(variation.totalCost ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span className="text-sm text-muted-foreground">
            · {coverage} shifts filled
          </span>
          {scoreLoading && (
            <span className="text-xs text-muted-foreground animate-pulse">
              <Activity className="inline h-3 w-3 mr-1" />Scoring...
            </span>
          )}
          {scoreResult && (() => {
            const { className: scoreCls, Icon: ScoreIcon } = scoreColor(scoreResult.score);
            return (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium cursor-default",
                  scoreCls,
                )}
                title={`Fairness: ${scoreResult.namedScores.fairness.toFixed(2)} · Cost: ${scoreResult.namedScores.costOptimality.toFixed(2)} · Preference: ${scoreResult.namedScores.preference.toFixed(2)}`}
              >
                <ScoreIcon className="h-3 w-3" />
                {scoreResult.score.toFixed(2)}
              </span>
            );
          })()}
        </div>
        {isApproved ? (
          <Button variant="outline" size="sm" disabled>
            <Check className="mr-1 h-4 w-4" />
            Approved
          </Button>
        ) : canApprove ? (
          <Button size="sm" onClick={onApprove} disabled={isApproving}>
            {isApproving ? "Approving..." : "Approve ✓"}
          </Button>
        ) : null}
      </div>

      {/* Coverage warnings */}
      <WarningPanel coverageWarnings={variation.coverageWarnings} />

      {/* Score breakdown */}
      {scoreResult && scoreResult.score > 0 && (
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span>Fairness: {scoreResult.namedScores.fairness.toFixed(2)}</span>
          <span>Cost: {scoreResult.namedScores.costOptimality.toFixed(2)}</span>
          <span>Preference: {scoreResult.namedScores.preference.toFixed(2)}</span>
        </div>
      )}

      {/* Slot-level constraint metrics */}
      {scoreResult?.slotMetrics && (
        <div className="flex flex-wrap gap-2 text-xs">
          <span className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 font-medium",
            scoreResult.slotMetrics.hoursCompliance === 1.0
              ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200"
              : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
          )}>
            Hours {scoreResult.slotMetrics.hoursCompliance === 1.0 ? "✓" : "✗"}
          </span>
          <span className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 font-medium",
            scoreResult.slotMetrics.minStaffCoverage >= 0.95
              ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200"
              : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
          )}>
            MinStaff {(scoreResult.slotMetrics.minStaffCoverage * 100).toFixed(0)}%
          </span>
          <span className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 font-medium",
            scoreResult.slotMetrics.eligibilityCompliance >= 0.98
              ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200"
              : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
          )}>
            Eligibility {(scoreResult.slotMetrics.eligibilityCompliance * 100).toFixed(0)}%
          </span>
          <span className="inline-flex items-center rounded-full px-2 py-0.5 font-medium bg-muted text-muted-foreground">
            Utilization {(scoreResult.slotMetrics.staffUtilization * 100).toFixed(0)}%
          </span>
          <span className="inline-flex items-center rounded-full px-2 py-0.5 font-medium bg-muted text-muted-foreground">
            Coverage {(scoreResult.slotMetrics.coverageCompleteness * 100).toFixed(0)}%
          </span>
        </div>
      )}

      {/* Tier-1 scoring violations */}
      {scoreResult && scoreResult.tier1Violations.length > 0 && (
        <div className="flex items-start gap-2 rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/30 dark:text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Hard constraint violations:</p>
            <ul className="mt-1 list-disc pl-4 space-y-0.5">
              {scoreResult.tier1Violations.map((v, i) => (
                <li key={i}>{v}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Assignments table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Day</TableHead>
            <TableHead>Shift</TableHead>
            <TableHead>Staff</TableHead>
            <TableHead>Time</TableHead>
            <TableHead className="text-right">Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((a, i) => {
            if (a.day !== lastDay) {
              dayGroupIndex++;
              lastDay = a.day;
            }
            return (
              <TableRow
                key={`${a.day}-${a.shiftType}-${a.staffId}-${i}`}
                className={cn(dayGroupIndex % 2 === 0 && "bg-muted/30")}
              >
                <TableCell className="font-medium">
                  {formatDayName(a.day)}
                </TableCell>
                <TableCell className="capitalize">{a.shiftType}</TableCell>
                <TableCell>{a.staffName}</TableCell>
                <TableCell>
                  {a.startTime} – {a.endTime}
                </TableCell>
                <TableCell className="text-right">
                  ${a.cost.toFixed(2)}
                </TableCell>
              </TableRow>
            );
          })}
          {sorted.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                No assignments in this variation.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
