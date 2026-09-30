import { eq, and, desc, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  scheduleRun,
  scheduleVariation,
  availabilitySubmission,
  business,
  staff,
  coverRequest,
  type ShiftAssignment,
} from "@/lib/db/schema";
import { getWeekStart, formatWeekRange } from "@/lib/date-utils";
import { inngest } from "@/lib/inngest/client";

export const HELP_TEXT = `Here's what I can help with:

• Tell me your availability (e.g. "Mon-Fri 9-5")
• Ask about your schedule (e.g. "When do I work?")
• Request cover (e.g. "Can't make it tomorrow")
• Check submission status (e.g. "Did my availability go through?")

Just send a message in plain English!`;

/**
 * Fetch this staff member's shifts for the current week from the latest
 * approved/finalised schedule variation.
 */
export async function handleScheduleQuery(
  staffId: string,
  businessId: string,
): Promise<string> {
  const biz = await db.query.business.findFirst({
    where: eq(business.id, businessId),
  });
  const weekStartDay = biz?.config?.weekStartDay ?? 1;
  const weekStart = getWeekStart(weekStartDay);
  const weekLabel = formatWeekRange(weekStart);

  // Find the latest approved or finalised run for this business + week
  const run = await db.query.scheduleRun.findFirst({
    where: and(
      eq(scheduleRun.businessId, businessId),
      eq(scheduleRun.weekStart, weekStart),
    ),
    with: { variations: true },
    orderBy: (r, { desc: d }) => [d(r.createdAt)],
  });

  if (!run || !["approved", "finalised"].includes(run.status)) {
    return `No schedule published for this week yet (${weekLabel}).`;
  }

  // Prefer approved variation, else first one
  const variation =
    run.variations.find((v) => v.approvedAt != null) ?? run.variations[0];
  if (!variation) {
    return `No schedule published for this week yet (${weekLabel}).`;
  }

  const myShifts = (variation.assignments as ShiftAssignment[]).filter(
    (a) => a.staffId === staffId,
  );

  if (myShifts.length === 0) {
    return `You have no shifts scheduled this week (${weekLabel}).`;
  }

  // Sort by day then start time
  myShifts.sort((a, b) => a.day.localeCompare(b.day) || a.startTime.localeCompare(b.startTime));

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const lines = myShifts.map((s) => {
    const d = new Date(s.day + "T00:00:00Z");
    const dayName = dayNames[d.getUTCDay()];
    return `• ${dayName} ${s.startTime}–${s.endTime}`;
  });

  return `Your schedule for ${weekLabel}:\n${lines.join("\n")}`;
}

/**
 * Fetch the latest availability submission for this staff member and
 * format a summary.
 */
export async function handleStatusQuery(staffId: string): Promise<string> {
  const latest = await db.query.availabilitySubmission.findFirst({
    where: eq(availabilitySubmission.staffId, staffId),
    orderBy: (t, { desc: d }) => [d(t.submittedAt)],
  });

  if (!latest) {
    return "You haven't submitted any availability yet. Send me your hours to get started!";
  }

  const weekStart = new Date(latest.weekStart);
  const weekLabel = formatWeekRange(weekStart);

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const lines = latest.slots.map((s) => {
    const d = new Date(s.day);
    const dayName = dayNames[d.getUTCDay()];
    if (s.preference === "unavailable") return `• ${dayName}: OFF`;
    return `• ${dayName}: ${s.startTime}–${s.endTime} ✓`;
  });

  return `Your availability for ${weekLabel}:\n${lines.join("\n")}\nStatus: ${latest.status}`;
}

/**
 * Handle a cover request: find the staff's shift on the given date,
 * create a coverRequest record, and fire an Inngest event to find candidates.
 *
 * The date is extracted by the message router, eliminating a separate LLM call.
 */
export interface CoverRequestResult {
  reply: string;
  coverRequestId?: string;
}

export async function handleCoverRequest(
  staffId: string,
  businessId: string,
  date: string | null,
): Promise<CoverRequestResult> {
  const biz = await db.query.business.findFirst({
    where: eq(business.id, businessId),
  });
  const weekStartDay = biz?.config?.weekStartDay ?? 1;

  const targetDate = date;

  if (!targetDate) {
    return { reply: "I couldn't figure out which day you need cover for. Try saying something like \"I can't make it tomorrow\" or \"need cover for Wednesday\"." };
  }

  // Find the week containing that date and look up the schedule
  const targetDateObj = new Date(targetDate + "T00:00:00Z");
  const weekStart = getWeekStart(weekStartDay, targetDateObj);

  const run = await db.query.scheduleRun.findFirst({
    where: and(
      eq(scheduleRun.businessId, businessId),
      eq(scheduleRun.weekStart, weekStart),
    ),
    with: { variations: true },
    orderBy: (r, { desc: d }) => [d(r.createdAt)],
  });

  if (!run || !["approved", "finalised"].includes(run.status)) {
    return { reply: `I couldn't find a published schedule for that week. Cover requests can only be made for scheduled shifts.` };
  }

  const variation =
    run.variations.find((v) => v.approvedAt != null) ?? run.variations[0];
  if (!variation) {
    return { reply: `I couldn't find a published schedule for that week.` };
  }

  // Find the staff's shift(s) on the target date
  const assignments = variation.assignments as ShiftAssignment[];
  const myShifts = assignments.filter(
    (a) => a.staffId === staffId && a.day === targetDate,
  );

  if (myShifts.length === 0) {
    return { reply: `I couldn't find a shift for you on ${targetDate}. Are you sure you're scheduled that day?` };
  }

  // Use the first shift (most common case: one shift per day)
  const shift = myShifts[0];

  // Create the cover request
  const [created] = await db
    .insert(coverRequest)
    .values({
      scheduleRunId: run.id,
      shiftId: `${variation.id}:${targetDate}:${shift.startTime}`,
      requestingStaffId: staffId,
      status: "open",
      candidates: [],
    })
    .returning();

  // Fire Inngest event to process the cover request
  await inngest.send({
    name: "cover/request.created",
    data: {
      coverRequestId: created.id,
      businessId,
      scheduleRunId: run.id,
      variationId: variation.id,
      targetDate,
      shiftStart: shift.startTime,
      shiftEnd: shift.endTime,
      shiftType: shift.shiftType,
      requestingStaffId: staffId,
    },
  });

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayName = dayNames[targetDateObj.getUTCDay()];

  return {
    reply: `Got it — I'll find someone to cover your ${dayName} ${shift.startTime}–${shift.endTime} shift. I'll let you know once it's sorted.`,
    coverRequestId: created.id,
  };
}

/**
 * Handle a swap request: find the staff's shift on the given date,
 * find swap candidates (same role, different shift), create a swap-type
 * coverRequest, and fire an Inngest event.
 */
export async function handleSwapRequest(
  staffId: string,
  businessId: string,
  date: string,
): Promise<CoverRequestResult> {
  const biz = await db.query.business.findFirst({
    where: eq(business.id, businessId),
  });
  const weekStartDay = biz?.config?.weekStartDay ?? 1;

  const targetDate = date;
  const targetDateObj = new Date(targetDate + "T00:00:00Z");
  const weekStart = getWeekStart(weekStartDay, targetDateObj);

  const run = await db.query.scheduleRun.findFirst({
    where: and(
      eq(scheduleRun.businessId, businessId),
      eq(scheduleRun.weekStart, weekStart),
    ),
    with: { variations: true },
    orderBy: (r, { desc: d }) => [d(r.createdAt)],
  });

  if (!run || !["approved", "finalised"].includes(run.status)) {
    return { reply: "I couldn't find a published schedule for that week. Swap requests can only be made for scheduled shifts." };
  }

  const variation =
    run.variations.find((v) => v.approvedAt != null) ?? run.variations[0];
  if (!variation) {
    return { reply: "I couldn't find a published schedule for that week." };
  }

  const assignments = variation.assignments as ShiftAssignment[];
  const myShifts = assignments.filter(
    (a) => a.staffId === staffId && a.day === targetDate,
  );

  if (myShifts.length === 0) {
    return { reply: `I couldn't find a shift for you on ${targetDate}. Are you sure you're scheduled that day?` };
  }

  const shift = myShifts[0];

  // Create the swap request
  const [created] = await db
    .insert(coverRequest)
    .values({
      scheduleRunId: run.id,
      requestType: "swap",
      shiftId: `${variation.id}:${targetDate}:${shift.startTime}`,
      requestingStaffId: staffId,
      status: "open",
      candidates: [],
    })
    .returning();

  // Fire Inngest event — reuses cover request processing
  await inngest.send({
    name: "cover/request.created",
    data: {
      coverRequestId: created.id,
      businessId,
      scheduleRunId: run.id,
      variationId: variation.id,
      targetDate,
      shiftStart: shift.startTime,
      shiftEnd: shift.endTime,
      shiftType: shift.shiftType,
      requestingStaffId: staffId,
      requestType: "swap",
    },
  });

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayName = dayNames[targetDateObj.getUTCDay()];

  return {
    reply: `Got it — I'll find someone to swap your ${dayName} ${shift.startTime}–${shift.endTime} shift with. I'll let you know once it's sorted.`,
    coverRequestId: created.id,
  };
}
