/**
 * Skill query — retrieves skills and composition rules for schedule generation.
 */

import { eq, and, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  staffSkill,
  shiftCompositionRule,
  staff as staffTable,
} from "@/lib/db/schema";

export interface StaffSkillRecord {
  id: string;
  staffId: string;
  tag: string;
  proficiency: number;
  notes: string | null;
  source: string;
}

export interface ShiftCompositionRuleRecord {
  id: string;
  shiftType: string | null;
  tag: string;
  minimumCount: number;
  minProficiency: number;
  required: boolean;
  condition?: { whenTagPresent?: string; whenMinCount?: number } | null;
}

/**
 * Query skills and composition rules for schedule generation.
 * Excludes inactive staff from skill results.
 */
export async function querySkillsForGeneration(
  businessId: string,
  staffIds: string[],
): Promise<{ skills: StaffSkillRecord[]; rules: ShiftCompositionRuleRecord[] }> {
  if (staffIds.length === 0) return { skills: [], rules: [] };

  // Only get skills for active staff
  const activeStaff = await db.query.staff.findMany({
    where: and(
      eq(staffTable.businessId, businessId),
      eq(staffTable.isActive, true),
    ),
  });
  const activeIds = new Set(activeStaff.map((s) => s.id));
  const filteredIds = staffIds.filter((id) => activeIds.has(id));

  const skills = filteredIds.length > 0
    ? await db.query.staffSkill.findMany({
        where: and(
          eq(staffSkill.businessId, businessId),
          inArray(staffSkill.staffId, filteredIds),
        ),
      })
    : [];

  const rules = await db.query.shiftCompositionRule.findMany({
    where: eq(shiftCompositionRule.businessId, businessId),
  });

  return {
    skills: skills.map((s) => ({
      id: s.id,
      staffId: s.staffId,
      tag: s.tag,
      proficiency: s.proficiency ?? 1.0,
      notes: s.notes,
      source: s.source,
    })),
    rules: rules.map((r) => ({
      id: r.id,
      shiftType: r.shiftType,
      tag: r.tag,
      minimumCount: r.minimumCount,
      minProficiency: r.minProficiency ?? 0.0,
      required: r.required,
    })),
  };
}

/**
 * Get all distinct skill tags for a business (for tag normalisation during extraction).
 */
export async function getExistingTags(businessId: string): Promise<string[]> {
  const rows = await db.query.staffSkill.findMany({
    where: eq(staffSkill.businessId, businessId),
    columns: { tag: true },
  });
  return [...new Set(rows.map((r) => r.tag))];
}
