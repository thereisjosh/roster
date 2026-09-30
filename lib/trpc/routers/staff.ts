import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { createRouter, businessProcedure } from "../init";
import { db } from "@/lib/db";
import { staff } from "@/lib/db/schema";
import { getTelegramConnectLink } from "@/lib/messaging/telegram-link";

export const staffRouter = createRouter({
  list: businessProcedure.query(async ({ ctx }) => {
    return db.query.staff.findMany({
      where: eq(staff.businessId, ctx.businessId),
      orderBy: (s, { asc }) => [asc(s.name)],
    });
  }),

  getById: businessProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const result = await db.query.staff.findFirst({
        where: and(
          eq(staff.id, input.id),
          eq(staff.businessId, ctx.businessId),
        ),
      });
      return result ?? null;
    }),

  create: businessProcedure
    .input(
      z.object({
        name: z.string().min(1),
        phone: z.string().optional(),
        email: z.string().email().optional(),
        employmentType: z
          .enum(["full_time", "part_time", "casual"])
          .default("part_time"),
        level: z.number().int().min(1).default(1),
        roles: z.array(z.string()).default([]),
        payStructure: z
          .object({
            baseHourlyRate: z.number(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [newStaff] = await db
        .insert(staff)
        .values({
          businessId: ctx.businessId,
          ...input,
        })
        .returning();

      // Fire-and-forget: log the connect link (actual sending via SMS/email is a future enhancement)
      const connectLink = getTelegramConnectLink(newStaff.id);
      if (connectLink) {
        console.log(`[staff.create] Telegram connect link for ${newStaff.name}: ${connectLink}`);
      }

      return newStaff;
    }),

  update: businessProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        phone: z.string().optional(),
        email: z.string().email().optional(),
        employmentType: z
          .enum(["full_time", "part_time", "casual"])
          .optional(),
        level: z.number().int().min(1).optional(),
        roles: z.array(z.string()).optional(),
        payStructure: z
          .object({
            baseHourlyRate: z.number(),
          })
          .optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const [updated] = await db
        .update(staff)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(staff.id, id), eq(staff.businessId, ctx.businessId)))
        .returning();
      return updated;
    }),

  deactivate: businessProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await db
        .update(staff)
        .set({ isActive: false, updatedAt: new Date() })
        .where(
          and(eq(staff.id, input.id), eq(staff.businessId, ctx.businessId)),
        )
        .returning();
      return updated;
    }),
});
