import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { availabilitySubmission } from "@/lib/db/schema";
import type { AvailabilitySlot } from "@/lib/db/schema";

/**
 * Upsert availability with slot-level merging.
 * Incoming slots override existing slots for the same day,
 * preserving previously submitted days.
 */
export async function upsertAvailability(
  staffId: string,
  weekStart: Date,
  slots: AvailabilitySlot[],
) {
  return await db.transaction(async (tx) => {
    const existing = await tx.query.availabilitySubmission.findFirst({
      where: and(
        eq(availabilitySubmission.staffId, staffId),
        eq(availabilitySubmission.weekStart, weekStart),
      ),
    });

    // Merge: new slots override existing slots for the same day
    let mergedSlots: AvailabilitySlot[];
    if (existing) {
      const incomingDays = new Set(slots.map((s) => s.day));
      const kept = (existing.slots ?? []).filter((s) => !incomingDays.has(s.day));
      mergedSlots = [...kept, ...slots];
    } else {
      mergedSlots = slots;
    }

    // Sort by day for consistency
    mergedSlots.sort((a, b) => a.day.localeCompare(b.day));

    if (existing) {
      const [updated] = await tx
        .update(availabilitySubmission)
        .set({
          slots: mergedSlots,
          status: "submitted",
          submittedAt: new Date(),
        })
        .where(eq(availabilitySubmission.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await tx
      .insert(availabilitySubmission)
      .values({
        staffId,
        weekStart,
        slots: mergedSlots,
        status: "submitted",
        submittedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [availabilitySubmission.staffId, availabilitySubmission.weekStart],
        set: { slots: mergedSlots, status: "submitted", submittedAt: new Date() },
      })
      .returning();
    return created;
  });
}
