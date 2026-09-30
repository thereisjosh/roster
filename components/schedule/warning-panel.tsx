"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  parseWarnings,
  groupWarnings,
  summarizeWarnings,
  type ParsedWarning,
  type WarningCategory,
} from "@/lib/scheduling/parse-warnings";

interface WarningPanelProps {
  coverageWarnings: string | null | undefined;
}

const GROUP_CONFIG: {
  key: WarningCategory;
  label: string;
  dotColor: string;
}[] = [
  { key: "supervision", label: "Supervision Gaps", dotColor: "bg-red-500" },
  { key: "coverage", label: "Coverage Notes", dotColor: "bg-amber-500" },
  { key: "hours", label: "Hours Budget", dotColor: "bg-amber-500" },
  { key: "ineligible", label: "Unavailable Staff", dotColor: "bg-gray-400" },
  { key: "info", label: "Info", dotColor: "bg-gray-400" },
];

function WarningGroup({
  label,
  dotColor,
  warnings,
  defaultOpen,
}: {
  label: string;
  dotColor: string;
  warnings: ParsedWarning[];
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (warnings.length === 0) return null;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full text-left text-sm font-medium py-1 hover:bg-muted/50 rounded px-1 -mx-1 cursor-pointer"
      >
        <span className={`h-2 w-2 rounded-full shrink-0 ${dotColor}`} />
        <span>
          {label} ({warnings.length})
        </span>
        <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground ml-auto transition-transform duration-200 ${open ? "rotate-90" : ""}`} />
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-in-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <ul className="ml-5 mt-1 space-y-0.5 text-sm text-muted-foreground pb-1">
            {warnings.map((w, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="mt-1.5 shrink-0">•</span>
                <span>{w.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function WarningPanel({ coverageWarnings }: WarningPanelProps) {
  const warnings = parseWarnings(coverageWarnings);
  if (warnings.length === 0) return null;

  const groups = groupWarnings(warnings);
  const summary = summarizeWarnings(warnings);

  return (
    <div className="rounded-md border p-3 space-y-2">
      {/* Summary header */}
      <div className="flex items-center gap-3 text-sm font-medium">
        {summary.errors > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-red-500" />
            {summary.errors} {summary.errors === 1 ? "Issue" : "Issues"}
          </span>
        )}
        {summary.warnings > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            {summary.warnings}{" "}
            {summary.warnings === 1 ? "Warning" : "Warnings"}
          </span>
        )}
        {summary.infos > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-gray-400" />
            {summary.infos} Info
          </span>
        )}
      </div>

      {/* Groups */}
      <div className="space-y-1">
        {GROUP_CONFIG.map(({ key, label, dotColor }) => (
          <WarningGroup
            key={key}
            label={label}
            dotColor={
              groups[key].some((w) => w.severity === "error")
                ? "bg-red-500"
                : dotColor
            }
            warnings={groups[key]}
            defaultOpen={groups[key].some((w) => w.severity === "error")}
          />
        ))}
      </div>
    </div>
  );
}
