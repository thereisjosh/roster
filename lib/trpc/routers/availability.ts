import { z } from "zod";
import { eq, and, inArray } from "drizzle-orm";
import { createRouter, businessProcedure } from "../init";
import { db } from "@/lib/db";
import { availabilitySubmission, staff } from "@/lib/db/schema";
import type { AvailabilitySlot } from "@/lib/db/schema";

export const availabilityRouter = createRouter({
  listForWeek: businessProcedure
    .input(z.object({ weekStart: z.coerce.date() }))
    .query(async ({ ctx, input }) => {
      const businessStaff = await db.query.staff.findMany({
        where: eq(staff.businessId, ctx.businessId),
        columns: { id: true },
      });
      const staffIds = businessStaff.map((s) => s.id);
      if (staffIds.length === 0) return [];

      return db.query.availabilitySubmission.findMany({
        where: and(
          eq(availabilitySubmission.weekStart, input.weekStart),
          inArray(availabilitySubmission.staffId, staffIds),
        ),
        with: { staff: true },
      });
    }),

  submit: businessProcedure
    .input(
      z.object({
        staffId: z.string().uuid(),
        weekStart: z.coerce.date(),
        slots: z.custom<AvailabilitySlot[]>(),
      }),
    )
    .mutation(async ({ input }) => {
      const existing = await db.query.availabilitySubmission.findFirst({
        where: and(
          eq(availabilitySubmission.staffId, input.staffId),
          eq(availabilitySubmission.weekStart, input.weekStart),
        ),
      });

      if (existing) {
        const [updated] = await db
          .update(availabilitySubmission)
          .set({
            slots: input.slots,
            status: "submitted",
            submittedAt: new Date(),
          })
          .where(eq(availabilitySubmission.id, existing.id))
          .returning();
        return updated;
      }

      const [created] = await db
        .insert(availabilitySubmission)
        .values({
          staffId: input.staffId,
          weekStart: input.weekStart,
          slots: input.slots,
          status: "submitted",
          submittedAt: new Date(),
        })
        .returning();
      return created;
    }),
});
