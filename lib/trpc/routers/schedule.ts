import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, businessProcedure } from "../init";
import { db } from "@/lib/db";
import {
  scheduleRun,
  scheduleVariation,
  managerEdit,
  business,
  staff as staffTable,
  availabilitySubmission,
  type BusinessConfig,
  type AvailabilitySlot,
} from "@/lib/db/schema";
import { generateSchedule } from "@/lib/scheduling/generator";
import { inngest } from "@/lib/inngest/client";
import { scoreVariation as scoreBridge } from "@/lib/scheduling/scorer-bridge";
import { getWeekDates } from "@/lib/date-utils";
import { getDefaultConfig } from "@/lib/config-defaults";
import { ingestApprovedSchedule } from "@/lib/knowledge/ingest";
import { reinforceFromApproval } from "@/lib/relationships/lifecycle";
import { extractManagerSignals } from "@/lib/skills/extract";
import { getExistingTags } from "@/lib/skills/query";

export const scheduleRouter = createRouter({
  generate: businessProcedure
    .input(z.object({ weekStart: z.date() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await generateSchedule(ctx.businessId, input.weekStart);

        if (result.status === "escalated") {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Schedule generation failed across all tiers. The run has been escalated for manual review.",
          });
        }

        // Return the created run with its variations
        const run = await db.query.scheduleRun.findFirst({
          where: and(
            eq(scheduleRun.id, result.runId),
            eq(scheduleRun.businessId, ctx.businessId),
          ),
          with: { variations: true },
        });

        return run;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Schedule generation failed",
        });
      }
    }),

  listRuns: businessProcedure.query(async ({ ctx }) => {
    return db.query.scheduleRun.findMany({
      where: eq(scheduleRun.businessId, ctx.businessId),
      with: { variations: true },
      orderBy: (r, { desc }) => [desc(r.createdAt)],
    });
  }),

  getRunById: businessProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const result = await db.query.scheduleRun.findFirst({
        where: and(
          eq(scheduleRun.id, input.id),
          eq(scheduleRun.businessId, ctx.businessId),
        ),
        with: { variations: true, managerEdits: true },
      });
      return result ?? null;
    }),

  approveVariation: businessProcedure
    .input(z.object({ variationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const updated = await db.transaction(async (tx) => {
        const [variation] = await tx
          .update(scheduleVariation)
          .set({ approvedAt: new Date(), approvedBy: ctx.user.id })
          .where(eq(scheduleVariation.id, input.variationId))
          .returning();

        if (variation) {
          await tx
            .update(scheduleRun)
            .set({ status: "approved", updatedAt: new Date() })
            .where(eq(scheduleRun.id, variation.runId));
        }

        return variation;
      });

      // Ingest approved schedule into knowledge base
      if (updated?.assignments) {
        const run = await db.query.scheduleRun.findFirst({
          where: eq(scheduleRun.id, updated.runId),
        });
        if (run) {
          const assignments = (updated.assignments as Array<{
            staffId: string;
            staffName: string;
            day: string;
            shiftType?: string;
            startTime: string;
            endTime: string;
          }>).map((a) => ({
            staffId: a.staffId,
            staffName: a.staffName ?? a.staffId,
            day: a.day,
            shiftType: a.shiftType ?? "shift",
            startTime: a.startTime,
            endTime: a.endTime,
          }));
          ingestApprovedSchedule(
            ctx.businessId,
            run.weekStart.toISOString().slice(0, 10),
            assignments,
          ).catch(() => {}); // fire-and-forget
        }
      }

      return updated;
    }),

  submitApprovalFeedback: businessProcedure
    .input(
      z.object({
        variationId: z.string().uuid(),
        rating: z.enum(["good", "some_edits", "significant_changes"]),
        comment: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [updated] = await db
        .update(scheduleVariation)
        .set({
          approvalFeedback: {
            rating: input.rating,
            comment: input.comment || undefined,
          },
        })
        .where(eq(scheduleVariation.id, input.variationId))
        .returning();

      // Positive reinforcement: when approved with "good" rating,
      // reinforce deterministically-verifiable relationship signals
      if (input.rating === "good" && updated?.assignments) {
        const assignments = updated.assignments as Array<{
          staffId: string;
          day: string;
          startTime: string;
          endTime: string;
          staffName: string;
          shiftType: string;
          cost: number;
        }>;
        reinforceFromApproval(ctx.businessId, assignments).catch(() => {});
      }

      // Run NL extraction on feedback comment if provided
      if (input.comment) {
        (async () => {
          try {
            const allStaff = await db.query.staff.findMany({
              where: and(
                eq(staffTable.businessId, ctx.businessId),
                eq(staffTable.isActive, true),
              ),
            });
            const existingTags = await getExistingTags(ctx.businessId);
            await extractManagerSignals(input.comment!, {
              businessId: ctx.businessId,
              staffNames: allStaff.map((s) => s.name),
              shiftTypes: [],
              existingTags,
            });
          } catch {
            // fire-and-forget
          }
        })();
      }

      return updated;
    }),

  recordEdit: businessProcedure
    .input(
      z.object({
        runId: z.string().uuid(),
        variationId: z.string().uuid(),
        staffId: z.string().uuid(),
        originalShift: z.string(),
        newShift: z.string(),
        editReason: z.string().optional(),
        extractedRules: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [edit] = await db
        .insert(managerEdit)
        .values(input)
        .returning();

      await inngest.send({
        name: "schedule/edit.recorded",
        data: { editId: edit.id, businessId: ctx.businessId },
      });

      return edit;
    }),

  finalise: businessProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await db
        .update(scheduleRun)
        .set({ status: "finalised", updatedAt: new Date() })
        .where(
          and(
            eq(scheduleRun.id, input.runId),
            eq(scheduleRun.businessId, ctx.businessId),
          ),
        )
        .returning();
      return updated;
    }),

  deleteRun: businessProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const run = await db.query.scheduleRun.findFirst({
        where: and(
          eq(scheduleRun.id, input.runId),
          eq(scheduleRun.businessId, ctx.businessId),
        ),
      });
      if (!run) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Schedule run not found" });
      }
      if (run.status === "finalised") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot delete a finalised schedule" });
      }
      await db.delete(scheduleRun).where(
        and(
          eq(scheduleRun.id, input.runId),
          eq(scheduleRun.businessId, ctx.businessId),
        ),
      );
      return { success: true };
    }),

  scoreVariation: businessProcedure
    .input(z.object({ variationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const variation = await db.query.scheduleVariation.findFirst({
        where: eq(scheduleVariation.id, input.variationId),
      });
      if (!variation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Variation not found" });
      }

      const run = await db.query.scheduleRun.findFirst({
        where: and(
          eq(scheduleRun.id, variation.runId),
          eq(scheduleRun.businessId, ctx.businessId),
        ),
      });
      if (!run) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Schedule run not found" });
      }
      if (!run.generationSnapshot) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No generation snapshot available for scoring (schedule was generated before scoring support was added)",
        });
      }

      return scoreBridge(run.generationSnapshot, variation.assignments);
    }),

  getAvailabilityMap: businessProcedure
    .input(z.object({ weekStart: z.date() }))
    .query(async ({ ctx, input }) => {
      // 1. Load business config
      const biz = await db.query.business.findFirst({
        where: eq(business.id, ctx.businessId),
      });
      if (!biz) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });
      }
      const config: BusinessConfig = biz.config ?? getDefaultConfig();

      // 2. Expand shifts for the week
      const weekDates = getWeekDates(input.weekStart);
      const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

      const days: Array<{
        date: string;
        dayName: string;
        shifts: Array<{
          id: string;
          name: string;
          startTime: string;
          endTime: string;
          minStaff: number;
        }>;
      }> = [];

      for (const date of weekDates) {
        const dayOfWeek = new Date(date + "T00:00:00Z").getUTCDay();
        if (config.closedDays?.includes(dayOfWeek)) continue;

        const dayName = dayNames[dayOfWeek];

        const dayShifts: typeof days[number]["shifts"] = [];
        for (const req of config.coverageRequirements) {
          if (!req.days.includes(dayOfWeek)) continue;
          dayShifts.push({
            id: `${date}-${req.role}-${req.startTime}`,
            name: `${req.role} ${req.startTime}-${req.endTime}`,
            startTime: req.startTime,
            endTime: req.endTime,
            minStaff: req.minStaff,
          });
        }

        const fmtDay = new Intl.DateTimeFormat("en-US", {
          weekday: "short",
          timeZone: "UTC",
        }).format(new Date(date + "T00:00:00Z"));

        days.push({ date, dayName: fmtDay, shifts: dayShifts });
      }

      // 3. Query active staff
      const activeStaff = await db.query.staff.findMany({
        where: and(
          eq(staffTable.businessId, ctx.businessId),
          eq(staffTable.isActive, true),
        ),
      });

      // 4. Query availability submissions for the week
      const submissions = await db.query.availabilitySubmission.findMany({
        where: eq(availabilitySubmission.weekStart, input.weekStart),
      });

      const staffIds = new Set(activeStaff.map((s) => s.id));
      const subsByStaff = new Map<string, AvailabilitySlot[]>();
      for (const sub of submissions) {
        if (staffIds.has(sub.staffId)) {
          subsByStaff.set(sub.staffId, sub.slots);
        }
      }

      // 5. Build flat shift list for overlap checks
      const allShifts = days.flatMap((d) =>
        d.shifts.map((s) => ({ ...s, date: d.date })),
      );

      // Helper: check if two time ranges overlap
      function timesOverlap(
        aStart: string, aEnd: string,
        bStart: string, bEnd: string,
      ): boolean {
        const toMin = (t: string) => {
          const [h, m] = t.split(":").map(Number);
          return h * 60 + m;
        };
        return toMin(aStart) < toMin(bEnd) && toMin(bStart) < toMin(aEnd);
      }

      // 6. Compute per-staff availability
      type AvailStatus = "available" | "preferred" | "implicit" | "none";

      const staffResult = activeStaff
        .sort((a, b) => {
          // FT first
          const typeOrder: Record<string, number> = { full_time: 0, part_time: 1, casual: 2 };
          const typeA = typeOrder[a.employmentType] ?? 1;
          const typeB = typeOrder[b.employmentType] ?? 1;
          if (typeA !== typeB) return typeA - typeB;
          // Then level desc
          if (b.level !== a.level) return b.level - a.level;
          // Then name
          return a.name.localeCompare(b.name);
        })
        .map((s) => {
          const slots = subsByStaff.get(s.id);
          const availability: Record<string, AvailStatus> = {};

          for (const shift of allShifts) {
            if (!slots) {
              // No submission: FT → implicit, others → none
              availability[shift.id] = s.employmentType === "full_time" ? "implicit" : "none";
              continue;
            }

            // Find best matching slot
            let best: AvailStatus = "none";
            for (const slot of slots) {
              if (slot.day !== shift.date) continue;
              if (!timesOverlap(slot.startTime, slot.endTime, shift.startTime, shift.endTime)) continue;

              if (slot.preference === "preferred") {
                best = "preferred";
                break;
              } else if (slot.preference === "available") {
                best = "available";
              }
              // "unavailable" slots don't contribute
            }

            availability[shift.id] = best;
          }

          return {
            id: s.id,
            name: s.name,
            employmentType: s.employmentType,
            level: s.level,
            availability,
          };
        });

      return { days, staff: staffResult };
    }),
});
