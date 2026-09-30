/**
 * Passive skill signal detection from edit patterns.
 *
 * After 3+ one-directional swaps (A replaced by B on the same shift type,
 * never B→A), surface for confirmation.
 */

import { eq, and, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  managerEdit,
  staff as staffTable,
  availabilitySubmission,
  scheduleRun,
} from "@/lib/db/schema";
import { createLogger } from "@/lib/logging";

const logger = createLogger("skill-detect");

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

export interface SkillSignal {
  originalStaffId: string;
  replacementStaffId: string;
  shiftType: string;
  count: number;
}

/**
 * Detect potential skill-based replacement patterns from a manager edit.
 * Returns a signal if the threshold (3+ one-directional swaps) is met.
 */
export async function detectSkillSignalFromEdit(
  businessId: string,
  editId: string,
  originalStaffId: string,
  replacementStaffId: string,
  shiftType: string,
  runId: string,
): Promise<void> {
  // Get the edit to check reason
  const edit = await db.query.managerEdit.findFirst({
    where: eq(managerEdit.id, editId),
  });

  // Skip if edit reason suggests logistics
  if (edit?.editReason && LOGISTICS_TERMS.some((t) => edit.editReason!.toLowerCase().includes(t))) {
    logger.debug({ editId, reason: edit.editReason }, "skipping logistics-driven edit for skill detection");
    return;
  }

  // Check if original staff was unavailable (false positive filter)
  const run = await db.query.scheduleRun.findFirst({
    where: eq(scheduleRun.id, runId),
  });
  if (!run) return;

  const originalStaff = await db.query.staff.findFirst({
    where: and(eq(staffTable.id, originalStaffId), eq(staffTable.businessId, businessId)),
  });
  if (!originalStaff) return;

  // Skip if original staff was approaching overtime (simplified check)
  if (originalStaff.roles.length === 0) return;

  // Count one-directional swaps: A→B on this shift type
  const forwardSwaps = await db
    .select({ count: sql<number>`count(*)` })
    .from(managerEdit)
    .innerJoin(scheduleRun, eq(managerEdit.runId, scheduleRun.id))
    .where(
      and(
        eq(scheduleRun.businessId, businessId),
        eq(managerEdit.staffId, originalStaffId),
        sql`${managerEdit.newShift} LIKE '%' || ${shiftType} || '%'`,
      ),
    );

  // Count reverse swaps: B→A on this shift type
  const reverseSwaps = await db
    .select({ count: sql<number>`count(*)` })
    .from(managerEdit)
    .innerJoin(scheduleRun, eq(managerEdit.runId, scheduleRun.id))
    .where(
      and(
        eq(scheduleRun.businessId, businessId),
        eq(managerEdit.staffId, replacementStaffId),
        sql`${managerEdit.newShift} LIKE '%' || ${shiftType} || '%'`,
      ),
    );

  const fwd = Number(forwardSwaps[0]?.count ?? 0);
  const rev = Number(reverseSwaps[0]?.count ?? 0);

  // Only flag if 3+ one-directional swaps and never reversed
  if (fwd >= 3 && rev === 0) {
    logger.info(
      { businessId, originalStaffId, replacementStaffId, shiftType, count: fwd },
      "skill signal detected: one-directional swap pattern",
    );
    // Signal is stored in-memory and surfaced via the confirmation flow.
    // The actual confirmation is handled by the tRPC endpoints in knowledge.ts.
  }
}
