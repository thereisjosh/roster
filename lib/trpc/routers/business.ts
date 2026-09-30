import { z } from "zod";
import { eq } from "drizzle-orm";
import { createRouter, protectedProcedure, businessProcedure } from "../init";
import { db } from "@/lib/db";
import { business, user } from "@/lib/db/schema";
import type { BusinessConfig } from "@/lib/db/schema";
import crypto from "crypto";

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I ambiguity
  let code = "";
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

export const businessRouter = createRouter({
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        timezone: z.string().default("Asia/Singapore"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [newBusiness] = await db
        .insert(business)
        .values({
          name: input.name,
          timezone: input.timezone,
          inviteCode: generateInviteCode(),
        })
        .returning();

      await db
        .update(user)
        .set({ businessId: newBusiness.id, role: "owner" })
        .where(eq(user.id, ctx.user.id));

      return newBusiness;
    }),

  getCurrent: businessProcedure.query(async ({ ctx }) => {
    const result = await db.query.business.findFirst({
      where: eq(business.id, ctx.businessId),
    });
    return result ?? null;
  }),

  updateConfig: businessProcedure
    .input(
      z.object({
        config: z.custom<BusinessConfig>(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [updated] = await db
        .update(business)
        .set({ config: input.config, updatedAt: new Date() })
        .where(eq(business.id, ctx.businessId))
        .returning();
      return updated;
    }),

  regenerateInviteCode: businessProcedure.mutation(async ({ ctx }) => {
    const [updated] = await db
      .update(business)
      .set({ inviteCode: generateInviteCode(), updatedAt: new Date() })
      .where(eq(business.id, ctx.businessId))
      .returning();
    return updated;
  }),
});
