import { z } from "zod";
import { eq } from "drizzle-orm";
import { createRouter, businessProcedure } from "../init";
import { db } from "@/lib/db";
import { coverRequest, scheduleRun } from "@/lib/db/schema";

export const coverRouter = createRouter({
  list: businessProcedure.query(async ({ ctx }) => {
    const runs = await db.query.scheduleRun.findMany({
      where: eq(scheduleRun.businessId, ctx.businessId),
      columns: { id: true },
    });
    const runIds = runs.map((r) => r.id);
    if (runIds.length === 0) return [];

    return db.query.coverRequest.findMany({
      with: { requestingStaff: true, scheduleRun: true },
      orderBy: (c, { desc }) => [desc(c.createdAt)],
    });
  }),

  create: businessProcedure
    .input(
      z.object({
        scheduleRunId: z.string().uuid(),
        shiftId: z.string(),
        requestingStaffId: z.string().uuid(),
        candidates: z.array(z.string()).default([]),
      }),
    )
    .mutation(async ({ input }) => {
      const [created] = await db
        .insert(coverRequest)
        .values(input)
        .returning();
      return created;
    }),

  updateStatus: businessProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        status: z.enum(["open", "filled", "escalated"]),
      }),
    )
    .mutation(async ({ input }) => {
      const [updated] = await db
        .update(coverRequest)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(coverRequest.id, input.id))
        .returning();
      return updated;
    }),

  fillCover: businessProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        filledBy: z.string().uuid(),
      }),
    )
    .mutation(async ({ input }) => {
      const [updated] = await db
        .update(coverRequest)
        .set({
          filledBy: input.filledBy,
          status: "filled",
          updatedAt: new Date(),
        })
        .where(eq(coverRequest.id, input.id))
        .returning();
      return updated;
    }),
});
