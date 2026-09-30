/**
 * Pair detection from manager edits.
 *
 * Detects separation signals (friction) and pairing signals (mentorship)
 * from edit patterns within a schedule run.
 */

import { eq, and, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  managerEdit,
  staffRelationship,
  staff as staffTable,
  availabilitySubmission,
  scheduleRun,
} from "@/lib/db/schema";
import { createLogger } from "@/lib/logging";

const logger = createLogger("relationship-detect");

const LOGISTICS_TERMS = [
  "overtime",
  "hours",
  "availability",
  "cover",
  "leave",
  "sick",
  "unavailable",
  "conflict",
  "rest",
  "consecutive",
];

/**
 * Detect potential pair dynamics from a manager edit.
 * Called from extract-preferences after each edit is recorded.
 *
 * Detection logic:
 * - Find other edits in the same run
 * - If this edit replaces one staff with another on a shift, check if the
 *   replaced staff is on other edits too (separation signal)
 * - If the same pair has 2+ separation signals, upsert a friction relationship
 */
export async function detectPairFromEdit(
  businessId: string,
  editId: string,
  staffId: string,
  originalShift: string,
  newShift: string,
  runId: string,
  editReason?: string | null,
): Promise<void> {
  // Skip if edit reason suggests logistics, not interpersonal dynamics
  if (editReason && LOGISTICS_TERMS.some((t) => editReason.toLowerCase().includes(t))) {
    logger.debug({ editId, reason: editReason }, "skipping logistics-driven edit");
    return;
  }

  // Find other edits in the same run that might indicate separation
  const otherEdits = await db.query.managerEdit.findMany({
    where: and(
      eq(managerEdit.runId, runId),
      ne(managerEdit.id, editId),
    ),
  });

  // Look for separation signals: another staff was on the original shift
  // or was moved to/from the same shift
  for (const other of otherEdits) {
    if (other.staffId === staffId) continue;

    // Case 1: This staff was moved OFF a shift, and another staff is ON that shift
    // (manager separated them)
    const isSeparation =
      other.originalShift === originalShift || // other was also on the original shift
      other.newShift === originalShift; // other was moved TO the original shift (swap)

    if (!isSeparation) continue;

    // Check false positives before recording
    const isFalsePositive = await checkFalsePositive(
      businessId,
      staffId,
      originalShift,
      runId,
    );
    if (isFalsePositive) {
      logger.debug(
        { editId, staffId, otherStaffId: other.staffId },
        "separation signal filtered as false positive",
      );
      continue;
    }

    // Normalize pair order for consistent storage
    const [id1, id2] = [staffId, other.staffId].sort();

    await upsertFrictionSignal(businessId, id1, id2, editId);
  }

  // Look for training/mentorship signals: a senior was added to a shift
  // containing a junior
  await detectTrainingSignal(businessId, editId, staffId, originalShift, newShift, runId);
}

async function checkFalsePositive(
  businessId: string,
  staffId: string,
  _originalShift: string,
  runId: string,
): Promise<boolean> {
  // Check if the moved staff was approaching overtime
  const run = await db.query.scheduleRun.findFirst({
    where: eq(scheduleRun.id, runId),
  });
  if (!run) return false;

  const staffMember = await db.query.staff.findFirst({
    where: and(eq(staffTable.id, staffId), eq(staffTable.businessId, businessId)),
  });
  if (!staffMember) return false;

  // Check if staff didn't have required role (qualification mismatch)
  // We can't fully verify without knowing the shift's required role from the shift ID,
  // but we check if the staff has very limited roles
  if (staffMember.roles.length === 0) return true;

  return false;
}

async function upsertFrictionSignal(
  businessId: string,
  staffId1: string,
  staffId2: string,
  editId: string,
): Promise<void> {
  const existing = await db.query.staffRelationship.findFirst({
    where: and(
      eq(staffRelationship.businessId, businessId),
      eq(staffRelationship.staffId1, staffId1),
      eq(staffRelationship.staffId2, staffId2),
      eq(staffRelationship.semantics, "separate"),
      eq(staffRelationship.label, "friction"),
    ),
  });

  const evidenceEntry = {
    editId,
    date: new Date().toISOString().slice(0, 10),
    description: "Staff separated in manager edit",
  };

  if (existing) {
    // Reinforce existing relationship
    const currentEvidence = (existing.evidence as typeof evidenceEntry[]) ?? [];
    await db
      .update(staffRelationship)
      .set({
        weight: Math.min(existing.weight + 1, 10),
        evidence: [...currentEvidence, evidenceEntry],
        lastReinforcedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(staffRelationship.id, existing.id));

    logger.info(
      { staffId1, staffId2, newWeight: existing.weight + 1 },
      "friction signal reinforced",
    );
  } else {
    // Only create edge after first signal (threshold is 1 for creation,
    // but weight starts at 1 — pair shows up for confirmation at weight >= 2)
    await db.insert(staffRelationship).values({
      businessId,
      staffId1,
      staffId2,
      semantics: "separate",
      label: "friction",
      weight: 1,
      confirmed: false,
      evidence: [evidenceEntry],
    });

    logger.info({ staffId1, staffId2 }, "new friction signal recorded");
  }
}

/**
 * Detect training/mentorship signals: a senior was added to a shift with a junior.
 */
async function detectTrainingSignal(
  businessId: string,
  editId: string,
  staffId: string,
  originalShift: string,
  newShift: string,
  runId: string,
): Promise<void> {
  // If a staff member was ADDED to a shift (originalShift is empty/removed, newShift is an assignment)
  // check if they're a senior and the shift has a junior
  const staffMember = await db.query.staff.findFirst({
    where: eq(staffTable.id, staffId),
  });
  if (!staffMember || staffMember.level < 2) return;

  // Find other edits in the same run where a junior is on the same new shift
  const otherEdits = await db.query.managerEdit.findMany({
    where: and(eq(managerEdit.runId, runId), ne(managerEdit.id, editId)),
  });

  for (const other of otherEdits) {
    if (other.staffId === staffId) continue;

    const otherStaff = await db.query.staff.findFirst({
      where: eq(staffTable.id, other.staffId),
    });
    if (!otherStaff || otherStaff.level >= 2) continue;

    // Junior is on the same shift as this senior
    if (other.newShift === newShift || other.originalShift === newShift) {
      // Record a training signal — junior needs senior
      const existing = await db.query.staffRelationship.findFirst({
        where: and(
          eq(staffRelationship.businessId, businessId),
          eq(staffRelationship.staffId1, other.staffId), // junior
          eq(staffRelationship.staffId2, staffId), // senior
          eq(staffRelationship.semantics, "pair"),
      eq(staffRelationship.label, "mentorship"),
        ),
      });

      const evidenceEntry = {
        editId,
        date: new Date().toISOString().slice(0, 10),
        description: `Senior ${staffMember.name} paired with junior ${otherStaff.name}`,
      };

      if (existing) {
        const currentEvidence = (existing.evidence as typeof evidenceEntry[]) ?? [];
        await db
          .update(staffRelationship)
          .set({
            weight: Math.min(existing.weight + 1, 10),
            evidence: [...currentEvidence, evidenceEntry],
            lastReinforcedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(staffRelationship.id, existing.id));
      } else {
        await db.insert(staffRelationship).values({
          businessId,
          staffId1: other.staffId, // junior
          staffId2: staffId, // senior
          semantics: "pair",
        label: "mentorship",
          weight: 1,
          confirmed: false,
          evidence: [evidenceEntry],
          metadata: {
            role: staffMember.roles[0], // best guess at relevant role
          },
        });
      }
    }
  }
}
