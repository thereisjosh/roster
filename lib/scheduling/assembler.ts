/**
 * Data assembler — queries the database and transforms Drizzle records
 * into the ScheduleInput format matching the eval golden data shape.
 */

import { eq, and, or, isNull, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  business,
  staff as staffTable,
  availabilitySubmission,
  preferenceRule,
  type BusinessConfig,
  type AvailabilitySlot,
} from "@/lib/db/schema";
import { getWeekDates } from "@/lib/date-utils";
import { getDefaultConfig } from "@/lib/config-defaults";
import { queryForGeneration } from "@/lib/knowledge/query";
import type { WikiContext } from "@/lib/knowledge/types";
import type { ScheduleInput, Shift, Staff, AvailabilityWindow } from "./validator";
import { queryRelationships, type StaffRelationshipRecord } from "@/lib/relationships/query";
import {
  querySkillsForGeneration,
  getExistingTags,
  type StaffSkillRecord,
  type ShiftCompositionRuleRecord,
} from "@/lib/skills/query";

export interface PreferenceRuleRecord {
  id: string;
  ruleText: string;
  ruleType: "soft" | "hard" | "temporary";
  confidence: number;
}

export interface AssembledData {
  input: ScheduleInput;
  preferenceRules: PreferenceRuleRecord[];
  weights: { costWeight: number; fairnessWeight: number; preferenceWeight: number };
  config: BusinessConfig;
  staffNames: Map<string, string>;
  wikiContext?: WikiContext;
  relationships?: StaffRelationshipRecord[];
  staffSkills?: StaffSkillRecord[];
  compositionRules?: ShiftCompositionRuleRecord[];
}

/**
 * Assembles all data needed for schedule generation from the database.
 *
 * @param businessId - The business to generate a schedule for
 * @param weekStart - The Monday (or configured start day) of the target week
 */
export async function assembleScheduleInput(
  businessId: string,
  weekStart: Date,
): Promise<AssembledData> {
  // 1. Load business config
  const biz = await db.query.business.findFirst({
    where: eq(business.id, businessId),
  });

  if (!biz) throw new Error(`Business ${businessId} not found`);
  const config: BusinessConfig = biz.config ?? getDefaultConfig();

  // 2. Query active staff
  const activeStaff = await db.query.staff.findMany({
    where: and(eq(staffTable.businessId, businessId), eq(staffTable.isActive, true)),
  });

  if (activeStaff.length === 0) {
    throw new Error("No active staff found for this business");
  }

  // 3. Query availability submissions for the target week
  const submissions = await db.query.availabilitySubmission.findMany({
    where: eq(availabilitySubmission.weekStart, weekStart),
  });

  // Filter to submissions for staff in this business
  const staffIds = new Set(activeStaff.map((s) => s.id));
  const relevantSubmissions = submissions.filter((sub) => staffIds.has(sub.staffId));

  // Build a map of staffId -> unavailable shift IDs
  const unavailabilityMap = buildUnavailabilityMap(relevantSubmissions, config, weekStart);

  // 4. Query knowledge base for relevant context, with fallback to flat rules
  const weekDates = getWeekDates(weekStart);
  const staffIdList = activeStaff.map((s) => s.id);
  const wikiContext = await queryForGeneration(businessId, staffIdList, weekDates);

  // Query staff relationships for pair dynamics
  const relationships = await queryRelationships(businessId, staffIdList);

  // Query skills and composition rules
  const { skills: staffSkills, rules: compositionRules } =
    await querySkillsForGeneration(businessId, staffIdList);

  const rules = await db.query.preferenceRule.findMany({
    where: and(
      eq(preferenceRule.businessId, businessId),
      eq(preferenceRule.active, true),
      or(isNull(preferenceRule.expiresAt), gt(preferenceRule.expiresAt, new Date())),
    ),
  });

  // 5. Expand coverage requirements into concrete shift slots for each day
  const shifts = expandCoverage(config, weekDates);

  // 6. Map staff records to ScheduleInput.staff format
  const staffNames = new Map<string, string>();
  const staffList: Staff[] = activeStaff.map((s) => {
    staffNames.set(s.id, s.name);
    const submission = relevantSubmissions.find((sub) => sub.staffId === s.id);
    const availability: AvailabilityWindow[] = submission?.slots
      ?.filter((slot) => slot.preference !== "unavailable")
      .map((slot) => ({
        day: slot.day,
        startTime: slot.startTime,
        endTime: slot.endTime,
        preference: slot.preference as "preferred" | "available",
      })) ?? [];

    return {
      id: s.id,
      qualifications: s.roles ?? [],
      maxWeeklyHours: computeMaxWeeklyHours(s.employmentType, config),
      hourlyRate: s.payStructure?.baseHourlyRate ?? 10,
      unavailable: unavailabilityMap.get(s.id) ?? [],  // backward compat
      availability,
      employmentType: s.employmentType === "full_time" ? "full-time" : "part-time",
      level: s.level >= 2 ? "L2" : "L1",
    };
  });

  return {
    input: {
      shifts,
      staff: staffList,
      constraints: {
        minRestHours: config.minRestHoursBetweenShifts,
        maxConsecutiveDays: config.maxConsecutiveDays,
      },
    },
    preferenceRules: rules.map((r) => ({
      id: r.id,
      ruleText: r.ruleText,
      ruleType: r.ruleType,
      confidence: r.confidence,
    })),
    weights: {
      costWeight: config.costWeight,
      fairnessWeight: config.fairnessWeight,
      preferenceWeight: config.preferenceWeight,
    },
    config,
    staffNames,
    wikiContext: wikiContext ?? undefined,
    relationships: relationships.length > 0 ? relationships : undefined,
    staffSkills: staffSkills.length > 0 ? staffSkills : undefined,
    compositionRules: compositionRules.length > 0 ? compositionRules : undefined,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Expands coverage requirements into concrete shifts for each day of the week.
 * Respects closedDays and per-requirement day filters.
 */
function expandCoverage(config: BusinessConfig, weekDates: string[]): Shift[] {
  const shifts: Shift[] = [];

  for (const date of weekDates) {
    const dayOfWeek = new Date(date + "T00:00:00Z").getUTCDay();
    if (config.closedDays?.includes(dayOfWeek)) continue;

    for (const req of config.coverageRequirements) {
      if (!req.days.includes(dayOfWeek)) continue;
      shifts.push({
        id: `${date}-${req.role}-${req.startTime}`,
        date,
        startTime: req.startTime,
        endTime: req.endTime,
        requiredRole: req.role,
        minStaff: req.minStaff,
        maxStaff: req.maxStaff,
      });
    }
  }

  return shifts;
}

/**
 * Builds a map of staffId -> array of shift IDs they're unavailable for,
 * based on their availability submissions.
 */
function buildUnavailabilityMap(
  submissions: Array<{ staffId: string; slots: AvailabilitySlot[] }>,
  config: BusinessConfig,
  weekStart: Date,
): Map<string, string[]> {
  const map = new Map<string, string[]>();

  for (const sub of submissions) {
    const unavailable: string[] = [];

    for (const slot of sub.slots) {
      if (slot.preference !== "unavailable") continue;

      const slotDate = new Date(slot.day + "T00:00:00Z");
      const dayOfWeek = slotDate.getUTCDay();

      // Find which coverage requirements overlap with this unavailability window
      for (const req of config.coverageRequirements) {
        if (!req.days.includes(dayOfWeek)) continue;
        const shiftId = `${slot.day}-${req.role}-${req.startTime}`;
        if (shiftsOverlap(slot.startTime, slot.endTime, req.startTime, req.endTime)) {
          unavailable.push(shiftId);
        }
      }
    }

    if (unavailable.length > 0) {
      map.set(sub.staffId, unavailable);
    }
  }

  return map;
}

function shiftsOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  const [aS, aE] = [toMinutes(aStart), toMinutes(aEnd)];
  const [bS, bE] = [toMinutes(bStart), toMinutes(bEnd)];
  return aS < bE && bS < aE;
}

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function computeMaxWeeklyHours(
  employmentType: "full_time" | "part_time" | "casual",
  config: BusinessConfig,
): number {
  switch (employmentType) {
    case "full_time":
      return config.fullTimeHours?.max ?? 44;
    case "part_time":
      return 30;
    case "casual":
      return 20;
    default:
      return 44;
  }
}
