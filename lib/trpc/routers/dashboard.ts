import { eq, and, count, gte, sql } from "drizzle-orm";
import { createRouter, businessProcedure } from "../init";
import { db } from "@/lib/db";
import {
  staff,
  scheduleRun,
  availabilitySubmission,
  coverRequest,
} from "@/lib/db/schema";

function getWeekStart(): Date {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const diff = day === 0 ? 6 : day - 1; // Monday-based
  const monday = new Date(now);
  monday.setDate(now.getDate() - diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

export const dashboardRouter = createRouter({
  stats: businessProcedure.query(async ({ ctx }) => {
    const weekStart = getWeekStart();

    const [activeStaffResult] = await db
      .select({ value: count() })
      .from(staff)
      .where(and(eq(staff.businessId, ctx.businessId), eq(staff.isActive, true)));

    const [scheduleRunsResult] = await db
      .select({ value: count() })
      .from(scheduleRun)
      .where(
        and(
          eq(scheduleRun.businessId, ctx.businessId),
          gte(scheduleRun.createdAt, weekStart),
        ),
      );

    // Availability submissions: count submissions from staff belonging to this business
    // for the current week
    const availabilityResult = await db
      .select({ value: count() })
      .from(availabilitySubmission)
      .innerJoin(staff, eq(availabilitySubmission.staffId, staff.id))
      .where(
        and(
          eq(staff.businessId, ctx.businessId),
          gte(availabilitySubmission.weekStart, weekStart),
        ),
      );

    // Open cover requests: find runs for this business, then count open requests
    const openCoverResult = await db
      .select({ value: count() })
      .from(coverRequest)
      .innerJoin(scheduleRun, eq(coverRequest.scheduleRunId, scheduleRun.id))
      .where(
        and(
          eq(scheduleRun.businessId, ctx.businessId),
          eq(coverRequest.status, sql`'open'`),
        ),
      );

    return {
      activeStaffCount: activeStaffResult?.value ?? 0,
      scheduleRunsThisWeek: scheduleRunsResult?.value ?? 0,
      availabilitySubmissionsThisWeek: availabilityResult[0]?.value ?? 0,
      openCoverRequests: openCoverResult[0]?.value ?? 0,
    };
  }),
});
