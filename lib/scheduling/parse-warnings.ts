export type WarningCategory =
  | "supervision"
  | "coverage"
  | "hours"
  | "ineligible"
  | "info";

export type WarningSeverity = "error" | "warning" | "info";

export interface ParsedWarning {
  category: WarningCategory;
  severity: WarningSeverity;
  text: string;
}

export interface GroupedWarnings {
  supervision: ParsedWarning[];
  coverage: ParsedWarning[];
  hours: ParsedWarning[];
  ineligible: ParsedWarning[];
  info: ParsedWarning[];
}

export interface WarningSummary {
  errors: number;
  warnings: number;
  infos: number;
}

function categorize(text: string): WarningCategory {
  const lower = text.toLowerCase();
  if (
    lower.includes("l1") ||
    lower.includes("l2") ||
    lower.includes("supervision") ||
    lower.includes("no l2/manager") ||
    lower.includes("supervisor")
  ) {
    return "supervision";
  }
  if (
    lower.includes("min staff") ||
    lower.includes("minstaff") ||
    lower.includes("coverage") ||
    /slot\b/.test(lower) ||
    lower.includes("minimum staff")
  ) {
    return "coverage";
  }
  if (
    lower.includes("gross slots") ||
    lower.includes("target") ||
    lower.includes("max") ||
    lower.includes("ceiling") ||
    lower.includes("hour")
  ) {
    return "hours";
  }
  if (
    lower.includes("0 eligible") ||
    lower.includes("no shift assigned") ||
    lower.includes("no eligible")
  ) {
    return "ineligible";
  }
  if (lower.includes("satisfied") || lower.includes("met")) {
    return "info";
  }
  return "info";
}

function severity(text: string): WarningSeverity {
  const lower = text.toLowerCase();
  if (
    lower.includes("warning") ||
    lower.includes("cannot be met") ||
    lower.includes("no l2/manager present") ||
    lower.includes("supervision gap") ||
    lower.includes("no l2")
  ) {
    return "error";
  }
  if (
    lower.includes("satisfied") ||
    lower.includes("met") ||
    lower.includes("0 eligible")
  ) {
    return "info";
  }
  return "warning";
}

export function parseWarnings(raw: string | null | undefined): ParsedWarning[] {
  if (!raw || !raw.trim()) return [];

  const parts = raw
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  return parts.map((text) => ({
    category: categorize(text),
    severity: severity(text),
    text,
  }));
}

export function groupWarnings(warnings: ParsedWarning[]): GroupedWarnings {
  const groups: GroupedWarnings = {
    supervision: [],
    coverage: [],
    hours: [],
    ineligible: [],
    info: [],
  };
  for (const w of warnings) {
    groups[w.category].push(w);
  }
  return groups;
}

export function summarizeWarnings(warnings: ParsedWarning[]): WarningSummary {
  let errors = 0;
  let infos = 0;
  let warns = 0;
  for (const w of warnings) {
    if (w.severity === "error") errors++;
    else if (w.severity === "info") infos++;
    else warns++;
  }
  return { errors, warnings: warns, infos };
}
