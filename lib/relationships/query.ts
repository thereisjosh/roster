/**
 * Relationship query — selective retrieval for schedule generation + conflict detection.
 */

import { and, eq, isNull, gte, or, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { staffRelationship } from "@/lib/db/schema";

export interface StaffRelationshipRecord {
  id: string;
  staffId1: string;
  staffId2: string | null;
  semantics: "separate" | "pair";
  label: string;
  weight: number;
  confirmed: boolean;
  metadata: { role?: string; minLevel?: number; decayAfterWeeks?: number };
}

export interface ConflictWarning {
  staffId: string;
  description: string;
}

/**
 * Query relationships relevant to a set of staff IDs.
 * Only returns non-rejected relationships above minimum weight.
 */
export async function queryRelationships(
  businessId: string,
  staffIds: string[],
): Promise<StaffRelationshipRecord[]> {
  if (staffIds.length === 0) return [];

  const rows = await db.query.staffRelationship.findMany({
    where: and(
      eq(staffRelationship.businessId, businessId),
      isNull(staffRelationship.rejectedAt),
      gte(staffRelationship.weight, 0.5),
      or(
        inArray(staffRelationship.staffId1, staffIds),
        inArray(staffRelationship.staffId2, staffIds),
      ),
    ),
  });

  return rows.map((r) => ({
    id: r.id,
    staffId1: r.staffId1,
    staffId2: r.staffId2,
    semantics: r.semantics as "separate" | "pair",
    label: r.label,
    weight: r.weight,
    confirmed: r.confirmed,
    metadata: (r.metadata ?? {}) as StaffRelationshipRecord["metadata"],
  }));
}

/**
 * Detect contradictory relationship signals for the same staff.
 * Example: friction(A, B) + mentorship(C, B) where A, B, C are all scheduled.
 */
export function detectConflicts(
  relationships: StaffRelationshipRecord[],
  staffIds: string[],
): ConflictWarning[] {
  const warnings: ConflictWarning[] = [];
  const staffSet = new Set(staffIds);

  // Build adjacency maps by type
  const frictionPairs = relationships.filter((r) => r.semantics === "separate");
  const affinityPairs = relationships.filter((r) => r.semantics === "pair");

  // For each staff member, check if they have both friction and affinity
  // with staff who might be on the same shift
  for (const staff of staffIds) {
    const frictionWith = frictionPairs
      .filter((r) => r.staffId1 === staff || r.staffId2 === staff)
      .map((r) => (r.staffId1 === staff ? r.staffId2 : r.staffId1))
      .filter((id): id is string => id !== null && staffSet.has(id));

    const affinityWith = affinityPairs
      .filter((r) => r.staffId1 === staff || r.staffId2 === staff)
      .map((r) => (r.staffId1 === staff ? r.staffId2 : r.staffId1))
      .filter((id): id is string => id !== null && staffSet.has(id));

    // Check overlap — staff has both friction and affinity connections
    // that might conflict on the same shift
    for (const affId of affinityWith) {
      for (const fricId of frictionWith) {
        if (affId !== fricId && staffSet.has(affId) && staffSet.has(fricId)) {
          warnings.push({
            staffId: staff,
            description:
              `${staff} mentors/pairs with ${affId} (should co-assign) ` +
              `but has friction with ${fricId} (should separate). ` +
              `Manager judgment needed if all three are scheduled together.`,
          });
        }
      }
    }
  }

  // Deduplicate warnings by description
  const seen = new Set<string>();
  return warnings.filter((w) => {
    if (seen.has(w.description)) return false;
    seen.add(w.description);
    return true;
  });
}
