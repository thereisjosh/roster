/**
 * Compressed slot-based eligibility computation.
 *
 * Ported from evals/transforms/compute-eligibility-compressed.js.
 * Explodes shifts into hourly slots, computes per-slot eligibility,
 * and produces all template variables for the compressed prompt.
 */

import type { ScheduleInput, Shift, Staff } from "./validator";
import type { PreferenceRuleRecord } from "./assembler";
import type { BusinessConfig } from "@/lib/db/schema";
import type { VariationType } from "./prompt-builder";
import type { WikiContext } from "@/lib/knowledge/types";
import { detectConflicts, type StaffRelationshipRecord } from "@/lib/relationships/query";
import type { StaffSkillRecord, ShiftCompositionRuleRecord } from "@/lib/skills/query";

const DAY_ABBREVS: Record<number, string> = {
  0: "sun", 1: "mon", 2: "tue", 3: "wed", 4: "thu", 5: "fri", 6: "sat",
};
const DAY_ORDER: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

function getDayAbbrev(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return DAY_ABBREVS[d.getUTCDay()] ?? dateStr;
}

function parseTimeToHours(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h + m / 60;
}

interface HourlySlot {
  day: string;
  date: string;
  hour: number;
  role: string;
  minStaff: number;
  maxStaff: number | null;
  eligible: string[];
  preferred: string[];
}

function isAvailableAtHour(staff: Staff, date: string, hour: number): boolean {
  if (!staff.availability || staff.availability.length === 0) return false;
  const windows = staff.availability.filter((w) => w.day === date);
  for (const w of windows) {
    const wStart = parseTimeToHours(w.startTime);
    const wEnd = parseTimeToHours(w.endTime);
    if (wStart <= hour + 0.001 && wEnd >= hour + 1 - 0.001) return true;
  }
  return false;
}

function isPreferredAtHour(staff: Staff, date: string, hour: number): boolean {
  if (!staff.availability || staff.availability.length === 0) return false;
  const windows = staff.availability.filter((w) => w.day === date && w.preference === "preferred");
  for (const w of windows) {
    const wStart = parseTimeToHours(w.startTime);
    const wEnd = parseTimeToHours(w.endTime);
    if (wStart <= hour + 0.001 && wEnd >= hour + 1 - 0.001) return true;
  }
  return false;
}

export interface EligibilityResult {
  eligibility_guide: string;
  staffing_plan: string;
  scheduling_params: string;
  constraint_tiers: string;
  soft_goals: string;
  hours_tracking: string;
  date_mapping: string;
  variation_guidance: string;
  fairness_check: string;
  pt_coverage_rule: string;
  ft_hours_rule: string;
  business_rules: string;
}

export function computeEligibility(
  input: ScheduleInput,
  config: BusinessConfig,
  preferenceRules: PreferenceRuleRecord[],
  variationType: VariationType,
  wikiContext?: WikiContext,
  relationships?: StaffRelationshipRecord[],
  staffSkills?: StaffSkillRecord[],
  compositionRules?: ShiftCompositionRuleRecord[],
): EligibilityResult {
  const staff = input.staff;
  const shifts = input.shifts;
  const ftHours = config.fullTimeHours;
  const minShiftHours = config.minShiftHours ?? 3;

  // Step 1: Explode shifts into hourly slots with eligibility
  const allSlots: HourlySlot[] = [];

  for (const shift of shifts) {
    const startH = parseTimeToHours(shift.startTime);
    const endH = parseTimeToHours(shift.endTime);
    const dayAbbrev = getDayAbbrev(shift.date);
    const role = shift.requiredRole;

    const firstHour = Math.ceil(startH - 0.001);
    const lastHour = Math.ceil(endH - 0.001) - 1;

    for (let h = firstHour; h <= lastHour; h++) {
      const eligible = staff
        .filter((s) => s.qualifications.some((q) => q === role))
        .filter((s) => isAvailableAtHour(s, shift.date, h))
        .map((s) => s.id);

      const preferred = staff
        .filter((s) => eligible.includes(s.id))
        .filter((s) => isPreferredAtHour(s, shift.date, h))
        .map((s) => s.id);

      allSlots.push({
        day: dayAbbrev,
        date: shift.date,
        hour: h,
        role,
        minStaff: shift.minStaff,
        maxStaff: shift.maxStaff ?? null,
        eligible,
        preferred,
      });
    }
  }

  // Step 2: Sort by day order, role, hour
  allSlots.sort((a, b) =>
    (DAY_ORDER[a.day] - DAY_ORDER[b.day]) ||
    a.role.localeCompare(b.role) ||
    (a.hour - b.hour),
  );

  // Step 3: Deduplicate slots
  const seen = new Set<string>();
  const uniqueSlots: HourlySlot[] = [];
  for (const slot of allSlots) {
    const key = slot.day + "-" + slot.role + "-" + slot.hour;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueSlots.push(slot);
    }
  }

  // Per-staff eligibility from individual slots
  const staffEligibility: Record<string, {
    totalSlotHours: number;
    daySlots: Record<string, HourlySlot[]>;
  }> = {};
  for (const s of staff) {
    staffEligibility[s.id] = { totalSlotHours: 0, daySlots: {} };
  }
  for (const slot of uniqueSlots) {
    for (const sid of slot.eligible) {
      if (staffEligibility[sid]) {
        staffEligibility[sid].totalSlotHours++;
        if (!staffEligibility[sid].daySlots[slot.date]) staffEligibility[sid].daySlots[slot.date] = [];
        staffEligibility[sid].daySlots[slot.date].push(slot);
      }
    }
  }

  // Break deduction computation
  const breakDeductMinutes = config.breakRules
    ? config.breakRules.reduce((sum, b) => sum + b.durationMinutes, 0)
    : 0;
  const breakDeductHours = breakDeductMinutes / 60;
  const breakDeductionEnabled = config.breakDeduction?.enabled ?? false;
  const breakAppliesTo = config.breakDeduction?.appliesTo ?? "both";

  function shouldDeductBreaksFor(s: Staff): boolean {
    if (!breakDeductionEnabled) return false;
    if (breakAppliesTo === "both") return true;
    if (breakAppliesTo === "full-time") return s.employmentType === "full-time";
    if (breakAppliesTo === "part-time") return s.employmentType === "part-time";
    return false;
  }

  // Compute per-staff eligible days and net hours
  const staffEligDays: Record<string, {
    dayGross: Record<string, number>;
    days: string[];
    netHours: number;
  }> = {};
  for (const s of staff) {
    const elig = staffEligibility[s.id];
    const dayGross: Record<string, number> = {};
    for (const date in elig.daySlots) {
      dayGross[date] = elig.daySlots[date].length;
    }
    const days = Object.keys(dayGross);
    let netHours = 0;
    const deductForThisStaff = shouldDeductBreaksFor(s);
    for (const day of days) {
      netHours += deductForThisStaff ? dayGross[day] - breakDeductHours : dayGross[day];
    }
    staffEligDays[s.id] = { dayGross, days, netHours };
  }

  // Pre-compute FT slot targets
  const ftSlotTargets: Record<string, {
    targetGross: number; minGross: number; maxGross: number;
    slotsPerDay: number; eligDays: number; totalEligSlots: number;
  }> = {};
  for (const s of staff) {
    if (s.employmentType !== "full-time" || !ftHours) continue;
    const eligDaysInfo = staffEligDays[s.id];
    const numDays = eligDaysInfo.days.length;
    if (numDays === 0) continue;
    let totalEligSlots = 0;
    for (const day of eligDaysInfo.days) {
      totalEligSlots += eligDaysInfo.dayGross[day];
    }
    const ftBreakDeduct = shouldDeductBreaksFor(s) ? breakDeductHours : 0;
    const targetGross = Math.min(ftHours.target + ftBreakDeduct * numDays, totalEligSlots);
    const minGross = Math.min(ftHours.min + ftBreakDeduct * numDays, totalEligSlots);
    const maxGross = Math.min(ftHours.max + ftBreakDeduct * numDays, totalEligSlots);
    const slotsPerDay = Math.round(targetGross / numDays);
    ftSlotTargets[s.id] = { targetGross, minGross, maxGross, slotsPerDay, eligDays: numDays, totalEligSlots };
  }

  // Build eligibility guide
  const slotsByDay: Record<string, HourlySlot[]> = {};
  for (const slot of uniqueSlots) {
    if (!slotsByDay[slot.day]) slotsByDay[slot.day] = [];
    slotsByDay[slot.day].push(slot);
  }

  const eligLines: string[] = [];
  const dayOrder = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  for (const day of dayOrder) {
    const daySlots = slotsByDay[day];
    if (!daySlots) continue;
    if (eligLines.length > 0) eligLines.push("");
    for (const slot of daySlots) {
      const slack = slot.eligible.length - slot.minStaff;
      const maxLabel = slot.maxStaff ? ", max " + slot.maxStaff : "";
      let annotation = "";
      if (slack === 0) {
        annotation = " [assign all]";
      } else if (slack < 0) {
        annotation = " [shortfall: " + (-slack) + "]";
      }
      const eligibleDisplay = slot.eligible.map((id) =>
        slot.preferred.includes(id) ? id + "*" : id,
      );
      eligLines.push(
        slot.day + " " + slot.role + " h" + slot.hour +
        " (min " + slot.minStaff + maxLabel + "): [" +
        eligibleDisplay.join(", ") + "]" + annotation,
      );
    }
  }

  const eligibility_guide = "COVERAGE REQUIREMENTS (assign eligible staff per slot-hour):\n* = staff marked this slot as preferred\n\n" + eligLines.join("\n");

  // Build staffing plan with hour budgets
  const budgetLines = staff.map((s) => {
    const type = s.employmentType === "full-time" ? "full-time" : "part-time";

    if (type === "full-time" && ftHours && ftSlotTargets[s.id]) {
      const ft = ftSlotTargets[s.id];
      const totalBreakH = breakDeductHours * ft.eligDays;
      if (variationType === "cost_optimised") {
        return "  " + s.id + ": full-time " + (s.qualifications || []).join("/") + ", TARGET " + ft.targetGross + " gross slots (" + ftHours.target + "h net + " + totalBreakH + "h breaks). Stay at target. Hard ceiling " + ft.maxGross;
      } else if (variationType === "fairness_optimised") {
        return "  " + s.id + ": full-time " + (s.qualifications || []).join("/") + ", TARGET " + ft.targetGross + " gross slots (" + ftHours.target + "h net + " + totalBreakH + "h breaks), min " + ft.minGross + ". Aim toward max " + ft.maxGross + " to maximize hours.";
      } else {
        return "  " + s.id + ": full-time " + (s.qualifications || []).join("/") + ", TARGET " + ft.targetGross + " gross slots (" + ftHours.target + "h net + " + totalBreakH + "h breaks), min " + ft.minGross + ", max " + ft.maxGross;
      }
    } else if (type === "full-time" && ftHours) {
      return "  " + s.id + ": full-time, 0 eligible days (on leave)";
    } else {
      const roles = (s.qualifications || []).join("/");
      return "  " + s.id + ": " + type + ", " + roles + ", " + (s.level || "?");
    }
  });

  // Per-staff wiki context (injected inline with budget lines)
  if (wikiContext) {
    for (let i = 0; i < budgetLines.length; i++) {
      const line = budgetLines[i];
      // Find staff ID in the line
      const staffMatch = staff.find((s) => line.includes(s.id));
      if (staffMatch) {
        const ctx = wikiContext.staffContext.get(staffMatch.id);
        if (ctx) {
          budgetLines[i] = line + "\n    Context: " + ctx;
        }
      }
    }
  }

  // Must-assign staff
  const mustAssignLines: string[] = [];
  for (const s of staff) {
    const elig = staffEligibility[s.id];
    const eligDays = Object.keys(elig.daySlots).length;
    if (eligDays === 0 || elig.totalSlotHours > 20) continue;
    if (s.employmentType === "full-time") continue;
    if (elig.totalSlotHours > 8 && variationType !== "fairness_optimised") continue;
    const dayList = Object.keys(elig.daySlots).map((d) => getDayAbbrev(d));
    if (eligDays === 1) {
      mustAssignLines.push("  " + s.id + ": " + elig.totalSlotHours + "h eligible on " + dayList[0] + " — assign to meet coverage");
    } else {
      mustAssignLines.push("  " + s.id + ": " + elig.totalSlotHours + "h eligible across " + eligDays + " days [" + dayList.join(", ") + "] — assign to meet coverage");
    }
  }

  // PT fairness checklist
  const ptChecklistLines: string[] = [];
  const ptStaff = staff.filter((s) => s.employmentType !== "full-time");
  ptStaff.sort((a, b) => {
    const aElig = staffEligibility[a.id]?.totalSlotHours ?? 0;
    const bElig = staffEligibility[b.id]?.totalSlotHours ?? 0;
    return aElig - bElig;
  });
  for (const ps of ptStaff) {
    const psElig = staffEligibility[ps.id];
    const psDays = staffEligDays[ps.id];
    const dayList = psDays ? psDays.days.map((d) => getDayAbbrev(d)).join(", ") : "none";
    const eligDayCount = Object.keys(psElig.daySlots).length;
    ptChecklistLines.push("  " + ps.id + ": " + psElig.totalSlotHours + " eligible hours, " + eligDayCount + " days, days: [" + dayList + "]");
  }

  // Assemble staffing plan
  const staffPlanParts = ["STAFF HOUR BUDGETS (each slot = 1 hour):"];
  staffPlanParts.push(...budgetLines);
  if (mustAssignLines.length > 0) {
    staffPlanParts.push("");
    staffPlanParts.push("MUST-ASSIGN STAFF (very few eligible slots — prioritize these):");
    staffPlanParts.push(...mustAssignLines);
  }
  if (ptChecklistLines.length > 0) {
    staffPlanParts.push("");
    if (variationType === "cost_optimised") {
      staffPlanParts.push("PART-TIME STAFF (assign only to fill coverage gaps below minStaff):");
    } else if (variationType === "fairness_optimised") {
      staffPlanParts.push("PART-TIME FAIRNESS CHECKLIST (ensure each gets shifts — fewest eligible hours first):");
    } else {
      staffPlanParts.push("PART-TIME FAIRNESS CHECKLIST (give each staff 1 shift, then fill coverage gaps only):");
    }
    staffPlanParts.push(...ptChecklistLines);
  }

  // Full-time staff scheduling section
  const ftScheduleLines: string[] = [];
  for (const s of staff) {
    if (s.employmentType !== "full-time" || !ftHours) continue;
    const ft = ftSlotTargets[s.id];
    if (!ft || ft.eligDays === 0) continue;
    const roles = (s.qualifications || []).join("/");
    const totalBreakH = breakDeductHours * ft.eligDays;
    const rawPerDay = ft.targetGross / ft.eligDays;
    const roundDir = (rawPerDay % 1) >= 0.5 ? "up" : "down";
    ftScheduleLines.push("  " + s.id + ": " + roles + ", " + ft.eligDays + " eligible days, " + ft.totalEligSlots + " eligible slots");
    ftScheduleLines.push("    Net hours: TARGET " + ftHours.target + "h (min " + ftHours.min + "h, max " + ftHours.max + "h)");
    ftScheduleLines.push("    Break deduction: " + breakDeductHours + "h/day x " + ft.eligDays + " days = " + totalBreakH + "h");
    ftScheduleLines.push("    Gross slots needed: TARGET " + ft.targetGross + " (min " + ft.minGross + ", max " + ft.maxGross + ")");
    ftScheduleLines.push("    Per day: ~" + ft.slotsPerDay + " slots/day (" + ft.targetGross + "/" + ft.eligDays + "=" + rawPerDay.toFixed(1) + " → round " + roundDir + ")");
    const eligDaysInfo = staffEligDays[s.id];
    const dayBreakdownParts: string[] = [];
    for (const dDate of eligDaysInfo.days) {
      const dDay = getDayAbbrev(dDate);
      const dSlots = eligDaysInfo.dayGross[dDate];
      dayBreakdownParts.push(dDay.charAt(0).toUpperCase() + dDay.slice(1) + "=" + dSlots);
    }
    ftScheduleLines.push("    Day breakdown: " + dayBreakdownParts.join(", "));
    if (ft.totalEligSlots > ft.maxGross) {
      ftScheduleLines.push("    ⚠ " + ft.totalEligSlots + " eligible slots > " + ft.maxGross + " max gross — exceeding max triggers overtime pay. Trim slots from START of lowest-demand days to stay within budget.");
    }
  }
  if (ftScheduleLines.length > 0) {
    staffPlanParts.push("");
    staffPlanParts.push("FULL-TIME STAFF (schedule these first — assign target slots as continuous blocks each day):");
    staffPlanParts.push(...ftScheduleLines);
  }
  // Pair dynamics from staff_relationship table
  if (relationships && relationships.length > 0) {
    const pairRels = relationships.filter((r) => r.semantics === "separate" || r.semantics === "pair");
    const trainingRels = relationships.filter((r) => r.semantics === "pair" && r.metadata?.minLevel);

    if (pairRels.length > 0) {
      staffPlanParts.push("");
      staffPlanParts.push("PAIR DYNAMICS (from observed patterns):");
      for (const rel of pairRels) {
        const action = rel.semantics === "separate" ? "avoid co-assignment" : "prefer co-assignment";
        const status = rel.confirmed ? `confirmed, weight ${rel.weight}` : `unconfirmed, weight ${rel.weight}`;
        staffPlanParts.push(`  ${rel.staffId1} ↔ ${rel.staffId2}: ${rel.label} (${status}) — ${action}`);
      }
    }

    // Inject training context inline with staff budget lines
    for (const rel of trainingRels) {
      const juniorId = rel.staffId1;
      const seniorId = rel.staffId2;
      const role = (rel.metadata?.role as string) ?? "any";
      const minLevel = (rel.metadata?.minLevel as number) ?? 2;
      const idx = budgetLines.findIndex((l) => l.includes(juniorId));
      if (idx >= 0) {
        const trainingNote = `\n    Training: ${rel.label} — requires senior (L${minLevel}+) on ${role} shifts${seniorId ? `. Prefer pairing with ${seniorId}.` : "."}`;
        budgetLines[idx] = budgetLines[idx] + trainingNote;
      }
    }

    // Conflict detection
    const staffIds = staff.map((s) => s.id);
    const conflicts = detectConflicts(relationships, staffIds);
    if (conflicts.length > 0) {
      staffPlanParts.push("");
      staffPlanParts.push("RELATIONSHIP CONFLICTS (manager judgment needed):");
      for (const c of conflicts) {
        staffPlanParts.push(`  Note: ${c.description}`);
      }
    }
  }
  // Per-staff skills inline with budget lines
  if (staffSkills && staffSkills.length > 0) {
    for (let i = 0; i < budgetLines.length; i++) {
      const line = budgetLines[i];
      const staffMatch = staff.find((s) => line.includes(s.id));
      if (staffMatch) {
        const skills = staffSkills.filter((sk) => sk.staffId === staffMatch.id);
        if (skills.length > 0) {
          const skillTags = skills.map((sk) => sk.tag).join(", ");
          budgetLines[i] = budgetLines[i] + `\n    Skills: ${skillTags}`;
        }
      }
    }
  }

  // Composition rules section
  if (compositionRules && compositionRules.length > 0) {
    staffPlanParts.push("");
    staffPlanParts.push("SHIFT COMPOSITION REQUIREMENTS:");
    for (const rule of compositionRules) {
      const shiftLabel = rule.shiftType ?? "ALL SHIFTS";
      const reqLabel = rule.required ? "Required" : "Preferred";
      // Find staff who have this tag
      const tagged = staffSkills
        ? staffSkills
            .filter((sk) => sk.tag === rule.tag && sk.proficiency >= rule.minProficiency)
            .map((sk) => sk.staffId)
        : [];
      const taggedDisplay = tagged.length > 0 ? tagged.join(", ") : "no one tagged";

      if (rule.condition?.whenTagPresent) {
        const triggerTag = rule.condition.whenTagPresent;
        const triggerMin = rule.condition.whenMinCount ?? 1;
        const triggerStaff = staffSkills
          ? staffSkills
              .filter((sk) => sk.tag === triggerTag)
              .map((sk) => sk.staffId)
          : [];
        const triggerDisplay = triggerStaff.length > 0 ? triggerStaff.join(", ") : "none";
        staffPlanParts.push(
          `  ${shiftLabel} — ${reqLabel} (min ${rule.minimumCount} ${rule.tag}):`,
        );
        staffPlanParts.push(
          `    Triggers when: ≥${triggerMin} ${triggerTag} staff assigned → ${triggerDisplay}`,
        );
        staffPlanParts.push(
          `    Satisfied by: ${taggedDisplay}`,
        );
        staffPlanParts.push(
          `    Note: all-${rule.tag} shifts have no supervision requirement`,
        );
      } else {
        staffPlanParts.push(
          `  ${shiftLabel} — ${reqLabel} (min ${rule.minimumCount}): ${rule.tag} → ${taggedDisplay}`,
        );
      }
    }
  }

  // Legacy: pair dynamics from wiki context (fallback)
  else if (wikiContext && wikiContext.pairDynamics.length > 0) {
    staffPlanParts.push("");
    staffPlanParts.push("PAIR DYNAMICS (observed from manager edits):");
    for (const pair of wikiContext.pairDynamics) {
      const label = pair.type === "affinity" ? "Pairs well" : pair.type === "friction" ? "Friction" : pair.type;
      const status = pair.confirmed ? "confirmed" : `unconfirmed, ${pair.evidence.length} observations`;
      staffPlanParts.push(`  ${pair.staffId1} ↔ ${pair.staffId2}: ${label} (${status})`);
    }
  }

  const staffing_plan = staffPlanParts.join("\n");

  // Scheduling parameters
  const paramParts: string[] = [];
  if (config.breakRules) {
    const breaks = config.breakRules.map((b) => b.name + ": " + b.durationMinutes + "min").join("; ");
    const deductNote = breakDeductionEnabled
      ? " (deducted from hours for " + (breakAppliesTo === "both" ? "all staff" : breakAppliesTo + " staff") + ")"
      : " (paid, not deducted)";
    paramParts.push("Break rules: " + breaks + deductNote);
  }
  if (config.fullTimeHours) {
    paramParts.push("Full-time hours: MINIMUM " + config.fullTimeHours.min + "h/week, TARGET " + config.fullTimeHours.target + "h/week, HARD MAX " + config.fullTimeHours.max + "h");
  }
  if (config.maxConsecutiveDays) {
    paramParts.push("Maximum consecutive working days: " + config.maxConsecutiveDays);
  }
  if (config.closedDays) {
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const closed = config.closedDays.map((d) => dayNames[d] || String(d)).join(", ");
    paramParts.push("Closed: " + closed);
  }
  const weights = { cost: config.costWeight, fairness: config.fairnessWeight, preference: config.preferenceWeight };
  paramParts.push("Optimisation weights: cost=" + weights.cost + ", fairness=" + weights.fairness + ", preference=" + weights.preference);
  paramParts.push("Minimum shift length: " + minShiftHours + " hours — every assignment must be a continuous block of at least " + minShiftHours + " hours");
  paramParts.push("Each slot = 1 hour of coverage. Assign staff to individual slot-hours.");

  let scheduling_params = paramParts.join("\n");

  // Hard constraint rules — prefer wiki-filtered rules when available
  const hardRules = wikiContext
    ? wikiContext.hardRules.map((r) => ({ ruleText: r.ruleText, ruleType: r.ruleType, confidence: r.confidence }))
    : preferenceRules.filter((r) => r.ruleType === "hard");
  const softRules = wikiContext
    ? wikiContext.softRules.map((r) => ({ ruleText: r.ruleText, ruleType: r.ruleType, confidence: r.confidence }))
    : preferenceRules.filter((r) => r.ruleType !== "hard");

  if (hardRules.length > 0) {
    scheduling_params += "\n\nHARD CONSTRAINTS:";
    for (const r of hardRules) {
      scheduling_params += "\n- " + r.ruleText;
    }
  }

  let business_rules = "";
  if (softRules.length > 0) {
    business_rules = softRules.map((r) => "PREFER (confidence: " + r.confidence.toFixed(1) + "): " + r.ruleText).join("\n");
  }

  // Hours tracking
  let hours_tracking = "HOURS TRACKING:\n- Each slot assignment = 1 hour of work";
  if (config.breakRules) {
    const totalBreakMin = config.breakRules.reduce((sum, b) => sum + b.durationMinutes, 0);
    if (totalBreakMin > 0 && breakDeductionEnabled) {
      hours_tracking += "\n- Break deductions apply to shifts spanning multiple hours — accounted for in slot eligibility";
    }
  }
  hours_tracking += "\n- Track total assigned slots against hour limits";

  // Constraint tiers
  const tierLines = ["CONSTRAINT TIERS:", "CRITICAL (never violate):"];
  tierLines.push("- Only assign staff to slots where they appear in the eligible list for that time range");
  tierLines.push("- Assign part-time staff only to slots where they are eligible");
  if (ftHours) {
    tierLines.push("- Full-time staff must not exceed " + ftHours.max + " total slot assignments");
    tierLines.push("- Full-time staff must be scheduled for at least " + ftHours.min + "h/week (after break deductions)");
  }
  tierLines.push("- Every FEASIBLE range must be staffed to AT LEAST minStaff");
  const constraint_tiers = tierLines.join("\n");

  // Soft goals with priority order
  const goalLines: string[] = [];
  const weightEntries = Object.entries(weights).sort((a, b) => b[1] - a[1]);
  goalLines.push("PRIORITY ORDER (when goals conflict):");
  goalLines.push("1. Coverage — every feasible range staffed to at least minStaff");
  goalLines.push("2. Hour limits — never exceed hard ceilings (fullTimeHours.max)");
  if (variationType === "cost_optimised") {
    goalLines.push("3. Full-time targets — schedule close to target hours");
    goalLines.push("4. Cost — minimize total labor cost");
    goalLines.push("5. Fairness — distribute shifts across staff where possible");
  } else if (variationType === "fairness_optimised") {
    goalLines.push("3. Fairness — every staff member who submitted availability must get at least 1 shift of " + minShiftHours + "+ hours this week");
    goalLines.push("4. Full-time targets — schedule close to target hours");
    goalLines.push("5. Cost — minimize total labor cost");
  } else {
    goalLines.push("3. Full-time targets — schedule close to target hours");
    goalLines.push("4. Fairness — every staff member who submitted availability must get at least 1 shift of " + minShiftHours + "+ hours this week");
    let priorityNum = 5;
    for (const entry of weightEntries) {
      if (entry[0] === "fairness") {
        // Already listed
      } else if (entry[0] === "cost" && entry[1] > 0) {
        goalLines.push(priorityNum + ". Cost (weight " + entry[1] + ") — minimize total labor cost");
        priorityNum++;
      } else if (entry[0] === "preference" && entry[1] > 0) {
        goalLines.push(priorityNum + ". Preference (weight " + entry[1] + ") — maximize preference adherence");
        priorityNum++;
      }
    }
  }

  goalLines.push("");
  goalLines.push("SOFT GOALS (optimise but don't sacrifice critical constraints):");
  for (const r of softRules) {
    goalLines.push("- " + r.ruleText);
  }
  if (!softRules.some((r) => /fair/i.test(r.ruleText))) {
    goalLines.push("- Distribute slot assignments fairly across staff");
  }
  if (!softRules.some((r) => /cost/i.test(r.ruleText))) {
    goalLines.push("- Minimize total labor cost while meeting all constraints");
  }
  goalLines.push("- When choosing between equally eligible staff, prefer those who marked the slot as \"preferred\" (shown with * in eligibility guide)");
  if (relationships && relationships.length > 0) {
    if (relationships.some((r) => r.semantics === "separate")) {
      goalLines.push("- Avoid scheduling 'separate' pairs on overlapping shifts (weight indicates strength)");
    }
    if (relationships.some((r) => r.semantics === "pair")) {
      goalLines.push("- Prefer co-scheduling 'pair' relationships when both are working");
    }
  }
  const soft_goals = goalLines.join("\n");

  // Date mapping
  const dateMappingEntries: string[] = [];
  for (const slot of uniqueSlots) {
    const entry = slot.day + " = " + slot.date;
    if (!dateMappingEntries.includes(entry)) dateMappingEntries.push(entry);
  }
  const date_mapping = "DATE MAPPING (use these dates in your output):\n" + dateMappingEntries.join("\n");

  // Variation-specific template variables
  let variation_guidance: string;
  let fairness_check: string;
  let pt_coverage_rule: string;
  let ft_hours_rule: string;

  if (variationType === "cost_optimised") {
    variation_guidance = "OPTIMIZATION: MINIMIZE COST\n- Every slot-hour must have at least minStaff assigned — this is non-negotiable\n- Target exactly minStaff (do not exceed unless forced or FT targets require it)\n- Do not add PT staff beyond minStaff for fairness — coverage efficiency is the priority\n- FT staff: stay at target gross slots, do not fill to max";
    fairness_check = "COVERAGE EFFICIENCY: After placing FT staff, fill all slots where assigned < minStaff with PT staff. Avoid exceeding maxStaff.";
    pt_coverage_rule = "PT staff: after FT placement, assign PT to every slot-hour where assigned < minStaff (mandatory), then stop";
    ft_hours_rule = "Full-time staff: assign their TARGET gross slots (see FULL-TIME STAFF section). Stay at target — do not fill toward max unless coverage requires it.";
  } else if (variationType === "fairness_optimised") {
    variation_guidance = "OPTIMIZATION: MAXIMIZE FAIRNESS\n- Every staff member who submitted availability must get at least 1 shift\n- Distribute hours as evenly as possible across all available staff\n- Assign up to maxStaff when it helps give shifts to underserved staff\n- FT staff: fill toward max gross slots to maximize their hours";
    fairness_check = "FAIRNESS CHECK: After placing FT staff: (1) Fill all slots where assigned < minStaff with eligible staff. (2) Then check if any staff with availability have 0 assignments — every staff member who submitted availability MUST get at least one shift this week (minimum shift length). Assign them a continuous block on one day. Prefer days/ranges where they fill coverage gaps. Avoid exceeding maxStaff in any slot.";
    pt_coverage_rule = "PT staff: assign to ensure everyone gets at least 1 shift this week";
    ft_hours_rule = "Full-time staff: assign up to their MAX gross slots (see FULL-TIME STAFF section) to maximize hours.";
  } else {
    variation_guidance = "OPTIMIZATION: BALANCED\n- Every slot-hour must have at least minStaff assigned — this is non-negotiable\n- Give each available staff member at least 1 shift for fairness\n- After meeting minStaff and the fairness minimum, prefer minStaff per slot to control cost\n- FT staff: aim for target gross slots";
    fairness_check = "FAIRNESS CHECK: After placing FT staff: (1) Fill all slots where assigned < minStaff with eligible staff. (2) Then give each unassigned staff member exactly one shift (minimum shift length) on their best-fit day. Prefer days/ranges where they fill coverage gaps. Do not assign additional shifts beyond the 1-shift minimum unless needed for minStaff. Avoid exceeding maxStaff.";
    pt_coverage_rule = "PT staff: give each person 1 shift for fairness, then assign to fill remaining gaps below minStaff";
    ft_hours_rule = "Full-time staff: assign their TARGET gross slots (see FULL-TIME STAFF section).";
  }

  return {
    eligibility_guide,
    staffing_plan,
    scheduling_params,
    constraint_tiers,
    soft_goals,
    hours_tracking,
    date_mapping,
    variation_guidance,
    fairness_check,
    pt_coverage_rule,
    ft_hours_rule,
    business_rules,
  };
}
