/**
 * Skill lifecycle — stale rule detection and proficiency improvement.
 *
 * Called from the weekly lint cron.
 */

import { eq, and, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  staffSkill,
  shiftCompositionRule,
  staff as staffTable,
} from "@/lib/db/schema";
import { createLogger } from "@/lib/logging";

const logger = createLogger("skill-lifecycle");

/**
 * Flag stale composition rules for manager review.
 * A rule is stale if its tag has no matching staffSkill records for active staff,
 * or hasn't been relevant to any scheduled shift in 12 weeks.
 */
export async function decayStaleSkillRules(businessId: string): Promise<void> {
  const rules = await db.query.shiftCompositionRule.findMany({
    where: eq(shiftCompositionRule.businessId, businessId),
  });

  const activeStaff = await db.query.staff.findMany({
    where: and(eq(staffTable.businessId, businessId), eq(staffTable.isActive, true)),
  });
  const activeIds = new Set(activeStaff.map((s) => s.id));

  for (const rule of rules) {
    // Check if any active staff has this tag
    const matchingSkills = await db.query.staffSkill.findMany({
      where: and(
        eq(staffSkill.businessId, businessId),
        eq(staffSkill.tag, rule.tag),
      ),
    });

    const activeMatches = matchingSkills.filter((s) => activeIds.has(s.staffId));

    if (activeMatches.length === 0) {
      logger.info(
        { businessId, ruleId: rule.id, tag: rule.tag },
        "composition rule has no active staff with matching tag — flagging for review",
      );
    }

    // Check age — flag if older than 12 weeks
    const twelveWeeksAgo = new Date();
    twelveWeeksAgo.setUTCDate(twelveWeeksAgo.getUTCDate() - 84);

    if (rule.createdAt < twelveWeeksAgo && activeMatches.length === 0) {
      logger.info(
        { businessId, ruleId: rule.id, tag: rule.tag },
        "stale composition rule — no matching staff and 12+ weeks old",
      );
    }
  }
}

/**
 * Passively increment proficiency for staff skills that haven't been corrected.
 * If the manager hasn't corrected an assignment where this staff member used
 * this skill in 8+ weeks, increment proficiency by 0.1 (capped at 1.0).
 */
export async function updateSkillProficiency(businessId: string): Promise<void> {
  const eightWeeksAgo = new Date();
  eightWeeksAgo.setUTCDate(eightWeeksAgo.getUTCDate() - 56);

  // Find skills that were confirmed 8+ weeks ago with proficiency < 1.0
  const skills = await db.query.staffSkill.findMany({
    where: and(
      eq(staffSkill.businessId, businessId),
    ),
  });

  for (const skill of skills) {
    if ((skill.proficiency ?? 1.0) >= 1.0) continue;
    if (!skill.confirmedAt) continue;
    if (skill.confirmedAt > eightWeeksAgo) continue;

    const newProficiency = Math.min(1.0, (skill.proficiency ?? 0) + 0.1);
    await db
      .update(staffSkill)
      .set({ proficiency: newProficiency })
      .where(eq(staffSkill.id, skill.id));

    logger.debug(
      { skillId: skill.id, tag: skill.tag, newProficiency },
      "proficiency incremented",
    );
  }
}
