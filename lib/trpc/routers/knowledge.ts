import { z } from "zod";
import { eq, and, isNull, gte, inArray } from "drizzle-orm";
import { createRouter, businessProcedure } from "../init";
import { db } from "@/lib/db";
import {
  staffRelationship,
  staff as staffTable,
  staffSkill,
  shiftCompositionRule,
} from "@/lib/db/schema";

export const knowledgeRouter = createRouter({
  listPairDynamics: businessProcedure.query(async ({ ctx }) => {
    // Query from staff_relationship table instead of knowledge pages
    const relationships = await db.query.staffRelationship.findMany({
      where: and(
        eq(staffRelationship.businessId, ctx.businessId),
        isNull(staffRelationship.rejectedAt),
        gte(staffRelationship.weight, 2),
      ),
    });

    // Look up staff names
    const staffIds = new Set<string>();
    for (const r of relationships) {
      staffIds.add(r.staffId1);
      if (r.staffId2) staffIds.add(r.staffId2);
    }

    const staffMembers = staffIds.size > 0
      ? await db.query.staff.findMany({
          where: eq(staffTable.businessId, ctx.businessId),
        })
      : [];
    const nameMap = new Map(staffMembers.map((s) => [s.id, s.name]));

    return relationships.map((r) => {
      const name1 = nameMap.get(r.staffId1) ?? r.staffId1;
      const name2 = r.staffId2 ? (nameMap.get(r.staffId2) ?? r.staffId2) : null;

      let description: string;
      if (r.semantics === "separate") {
        description = `We noticed you've separated ${name1} and ${name2} on ${Math.floor(r.weight)} occasion${r.weight !== 1 ? "s" : ""} ("${r.label}"). Should we avoid scheduling them together?`;
      } else {
        description = `We noticed you prefer pairing ${name1} and ${name2} ("${r.label}"). Should we continue this?`;
      }

      return {
        id: r.id,
        slug: r.id, // backward compat — UI uses slug as key
        semantics: r.semantics,
        label: r.label,
        description,
        evidenceCount: (r.evidence as unknown[])?.length ?? 0,
        weight: r.weight,
        confirmed: r.confirmed,
        staffIds: [r.staffId1, ...(r.staffId2 ? [r.staffId2] : [])],
      };
    });
  }),

  confirmPair: businessProcedure
    .input(z.object({ slug: z.string(), label: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const rel = await db.query.staffRelationship.findFirst({
        where: and(
          eq(staffRelationship.id, input.slug),
          eq(staffRelationship.businessId, ctx.businessId),
        ),
      });
      if (!rel) return { success: false };

      await db
        .update(staffRelationship)
        .set({
          confirmed: true,
          weight: Math.min(rel.weight + 5, 10),
          lastReinforcedAt: new Date(),
          updatedAt: new Date(),
          ...(input.label ? { label: input.label } : {}),
        })
        .where(eq(staffRelationship.id, rel.id));

      return { success: true };
    }),

  dismissPair: businessProcedure
    .input(z.object({ slug: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const rel = await db.query.staffRelationship.findFirst({
        where: and(
          eq(staffRelationship.id, input.slug),
          eq(staffRelationship.businessId, ctx.businessId),
        ),
      });
      if (!rel) return { success: false };

      await db
        .update(staffRelationship)
        .set({
          rejectedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(staffRelationship.id, rel.id));

      return { success: true };
    }),

  removeConfirmation: businessProcedure
    .input(z.object({ slug: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const rel = await db.query.staffRelationship.findFirst({
        where: and(
          eq(staffRelationship.id, input.slug),
          eq(staffRelationship.businessId, ctx.businessId),
        ),
      });
      if (!rel) return { success: false };

      // Revert to unconfirmed with organic weight (subtract the confirmation bonus)
      const organicWeight = Math.max(1, rel.weight - 5);
      await db
        .update(staffRelationship)
        .set({
          confirmed: false,
          weight: organicWeight,
          updatedAt: new Date(),
        })
        .where(eq(staffRelationship.id, rel.id));

      return { success: true };
    }),

  confirmCompositionRequirement: businessProcedure
    .input(z.object({
      tag: z.string(),
      shiftType: z.string().optional(),
      required: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      const [rule] = await db
        .insert(shiftCompositionRule)
        .values({
          businessId: ctx.businessId,
          tag: input.tag,
          shiftType: input.shiftType ?? null,
          required: input.required,
          minimumCount: 1,
        })
        .returning();
      return rule;
    }),

  tagStaffWithSkill: businessProcedure
    .input(z.object({
      staffIds: z.array(z.string().uuid()),
      tag: z.string(),
      source: z.enum(["manager_explicit", "inferred", "extracted"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const results = [];
      for (const staffId of input.staffIds) {
        const [row] = await db
          .insert(staffSkill)
          .values({
            businessId: ctx.businessId,
            staffId,
            tag: input.tag,
            source: input.source,
            confirmedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [staffSkill.staffId, staffSkill.tag],
            set: {
              source: input.source,
              confirmedAt: new Date(),
            },
          })
          .returning();
        results.push(row);
      }
      return results;
    }),
});
