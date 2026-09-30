/**
 * Relationship lifecycle — reinforcement, decay, graduation.
 *
 * Called from:
 * - lint.ts (weekly cron) for decay and graduation checks
 * - schedule.ts (approval handler) for positive reinforcement
 */

import { eq, and, lt, lte, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  staffRelationship,
  preferenceRule,
  type ShiftAssignment,
} from "@/lib/db/schema";
import { createLogger } from "@/lib/logging";

const logger = createLogger("relationship-lifecycle");

// ---------------------------------------------------------------------------
// Decay
// ---------------------------------------------------------------------------

export interface DecayResult {
  decayedRelationships: string[];
  deletedRelationships: string[];
  decayedRules: string[];
}

/**
 * Apply decay to stale relationships and preference rules.
 * Called from the weekly lint cron.
 */
export async function applyDecay(businessId: string): Promise<DecayResult> {
  const result: DecayResult = {
    decayedRelationships: [],
    deletedRelationships: [],
    decayedRules: [],
  };

  const sixWeeksAgo = new Date();
  sixWeeksAgo.setUTCDate(sixWeeksAgo.getUTCDate() - 42);

  // Decay unconfirmed relationships not reinforced in 6+ weeks with weight < 3
  const staleRelationships = await db.query.staffRelationship.findMany({
    where: and(
      eq(staffRelationship.businessId, businessId),
      eq(staffRelationship.confirmed, false),
      isNull(staffRelationship.rejectedAt),
      lt(staffRelationship.lastReinforcedAt, sixWeeksAgo),
      lte(staffRelationship.weight, 3),
    ),
  });

  for (const rel of staleRelationships) {
    const newWeight = Math.max(0, rel.weight - 1);
    if (newWeight <= 0) {
      await db.delete(staffRelationship).where(eq(staffRelationship.id, rel.id));
      result.deletedRelationships.push(rel.id);
    } else {
      await db
        .update(staffRelationship)
        .set({ weight: newWeight, updatedAt: new Date() })
        .where(eq(staffRelationship.id, rel.id));
      result.decayedRelationships.push(rel.id);
    }
  }

  // Decay preference rules not reinforced in 8+ weeks with confidence < 0.9
  const eightWeeksAgo = new Date();
  eightWeeksAgo.setUTCDate(eightWeeksAgo.getUTCDate() - 56);

  const staleRules = await db.query.preferenceRule.findMany({
    where: and(
      eq(preferenceRule.businessId, businessId),
      eq(preferenceRule.active, true),
      isNull(preferenceRule.rejectedAt),
      lt(preferenceRule.confidence, 0.9),
    ),
  });

  for (const rule of staleRules) {
    // Use lastReinforcedAt if available, otherwise createdAt
    const lastActive = rule.lastReinforcedAt ?? rule.createdAt;
    if (lastActive >= eightWeeksAgo) continue;

    const newConfidence = Math.max(0, rule.confidence - 0.1);
    const updates: Record<string, unknown> = { confidence: newConfidence };
    if (newConfidence < 0.3) {
      updates.active = false;
    }
    await db.update(preferenceRule).set(updates).where(eq(preferenceRule.id, rule.id));
    result.decayedRules.push(rule.id);
  }

  logger.info(
    {
      businessId,
      decayedRelationships: result.decayedRelationships.length,
      deletedRelationships: result.deletedRelationships.length,
      decayedRules: result.decayedRules.length,
    },
    "decay applied",
  );

  return result;
}

// ---------------------------------------------------------------------------
// Positive reinforcement from approved schedules
// ---------------------------------------------------------------------------

/**
 * Reinforce deterministically-verifiable signals when a schedule is approved
 * with a "good" rating (no edits).
 */
export async function reinforceFromApproval(
  businessId: string,
  assignments: ShiftAssignment[],
): Promise<void> {
  const { queryRelationships } = await import("./query");

  const staffIds = [...new Set(assignments.map((a) => a.staffId))];
  const relationships = await queryRelationships(businessId, staffIds);

  for (const rel of relationships) {
    if (rel.semantics === "separate" && rel.staffId2) {
      // Verify friction pair was NOT co-assigned on any overlapping shift
      const respected = !areCoAssigned(rel.staffId1, rel.staffId2, assignments);
      if (respected) {
        await db
          .update(staffRelationship)
          .set({
            weight: Math.min(rel.weight + 0.5, 10),
            lastReinforcedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(staffRelationship.id, rel.id));
      }
    } else if (rel.semantics === "pair" && rel.staffId2) {
      // Verify mentorship/affinity pair WAS co-assigned
      const respected = areCoAssigned(rel.staffId1, rel.staffId2, assignments);
      if (respected) {
        await db
          .update(staffRelationship)
          .set({
            weight: Math.min(rel.weight + 0.5, 10),
            lastReinforcedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(staffRelationship.id, rel.id));
      }
    }
  }

  logger.info({ businessId, staffCount: staffIds.length }, "approval reinforcement applied");
}

function areCoAssigned(
  staffId1: string,
  staffId2: string,
  assignments: ShiftAssignment[],
): boolean {
  // Group assignments by day
  const byDay = new Map<string, ShiftAssignment[]>();
  for (const a of assignments) {
    const day = a.day;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(a);
  }

  for (const [, dayAssignments] of byDay) {
    const staff1Shifts = dayAssignments.filter((a) => a.staffId === staffId1);
    const staff2Shifts = dayAssignments.filter((a) => a.staffId === staffId2);

    for (const s1 of staff1Shifts) {
      for (const s2 of staff2Shifts) {
        // Check time overlap
        const s1Start = timeToMinutes(s1.startTime);
        const s1End = timeToMinutes(s1.endTime);
        const s2Start = timeToMinutes(s2.startTime);
        const s2End = timeToMinutes(s2.endTime);
        if (s1Start < s2End && s2Start < s1End) {
          return true;
        }
      }
    }
  }

  return false;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

// ---------------------------------------------------------------------------
// Graduation check (for training/mentorship relationships)
// ---------------------------------------------------------------------------

export interface GraduationCandidate {
  relationshipId: string;
  staffId1: string;
  staffId2: string | null;
  type: string;
  description: string;
}

/**
 * Check for mentorship/requires_senior relationships that may have graduated.
 * Called from the weekly lint cron.
 */
export async function checkGraduations(
  businessId: string,
): Promise<GraduationCandidate[]> {
  const candidates: GraduationCandidate[] = [];

  const trainingRels = await db.query.staffRelationship.findMany({
    where: and(
      eq(staffRelationship.businessId, businessId),
      isNull(staffRelationship.rejectedAt),
    ),
  });

  const now = new Date();

  for (const rel of trainingRels) {
    if (rel.semantics !== "pair" || !((rel.metadata ?? {}) as { decayAfterWeeks?: number }).decayAfterWeeks) continue;

    const meta = (rel.metadata ?? {}) as { decayAfterWeeks?: number };
    const weeksElapsed = (now.getTime() - rel.createdAt.getTime()) / (1000 * 60 * 60 * 24 * 7);
    if (meta.decayAfterWeeks && weeksElapsed >= meta.decayAfterWeeks) {
      candidates.push({
        relationshipId: rel.id,
        staffId1: rel.staffId1,
        staffId2: rel.staffId2,
        type: rel.semantics + ":" + rel.label,
        description:
          `Training relationship has been active for ${Math.floor(weeksElapsed)} weeks ` +
          `(threshold: ${meta.decayAfterWeeks}). Consider graduation.`,
      });
    }
  }

  return candidates;
}
