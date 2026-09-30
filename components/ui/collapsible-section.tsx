"use client";

import { useState, useId, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

interface CollapsibleSectionProps {
  title: string;
  description: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function CollapsibleSection({
  title,
  description,
  summary,
  defaultOpen = false,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const contentId = `${id}-content`;
  const titleId = `${id}-title`;

  return (
    <div className="rounded-lg border">
      <button
        type="button"
        className="flex w-full items-center justify-between p-4 text-left"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={contentId}
      >
        <div className="min-w-0">
          <h3 id={titleId} className="text-sm font-medium">
            {title}
          </h3>
          <p className="text-[13px] text-muted-foreground">{description}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-4">
          {!open && summary && (
            <span className="text-xs text-muted-foreground hidden sm:block">
              {summary}
            </span>
          )}
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${
              open ? "rotate-180" : ""
            }`}
          />
        </div>
      </button>
      <div
        id={contentId}
        role="region"
        aria-labelledby={titleId}
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="px-4 pb-4 pt-0 space-y-4">{children}</div>
        </div>
      </div>
    </div>
  );
}
