import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { createRouter, businessProcedure } from "../init";
import { db } from "@/lib/db";
import { preferenceRule } from "@/lib/db/schema";

export const preferencesRouter = createRouter({
  list: businessProcedure.query(async ({ ctx }) => {
    return db.query.preferenceRule.findMany({
      where: eq(preferenceRule.businessId, ctx.businessId),
      orderBy: (r, { desc }) => [desc(r.createdAt)],
    });
  }),

  create: businessProcedure
    .input(
      z.object({
        ruleText: z.string().min(1),
        ruleType: z.enum(["soft", "hard", "temporary"]).default("soft"),
        source: z
          .enum(["manager_explicit", "learned_from_edit", "staff_request"])
          .default("manager_explicit"),
        confidence: z.number().min(0).max(1).default(1.0),
        expiresAt: z.coerce.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [rule] = await db
        .insert(preferenceRule)
        .values({
          businessId: ctx.businessId,
          ...input,
        })
        .returning();
      return rule;
    }),

  toggleActive: businessProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        active: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [updated] = await db
        .update(preferenceRule)
        .set({ active: input.active })
        .where(
          and(
            eq(preferenceRule.id, input.id),
            eq(preferenceRule.businessId, ctx.businessId),
          ),
        )
        .returning();
      return updated;
    }),

  confirm: businessProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await db
        .update(preferenceRule)
        .set({
          active: true,
          confidence: 1.0,
          source: "manager_explicit",
        })
        .where(
          and(
            eq(preferenceRule.id, input.id),
            eq(preferenceRule.businessId, ctx.businessId),
          ),
        )
        .returning();
      return updated;
    }),

  reject: businessProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await db
        .update(preferenceRule)
        .set({ active: false, rejectedAt: new Date() })
        .where(
          and(
            eq(preferenceRule.id, input.id),
            eq(preferenceRule.businessId, ctx.businessId),
          ),
        )
        .returning();
      return updated;
    }),

  delete: businessProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await db
        .delete(preferenceRule)
        .where(
          and(
            eq(preferenceRule.id, input.id),
            eq(preferenceRule.businessId, ctx.businessId),
          ),
        );
      return { success: true };
    }),
});
