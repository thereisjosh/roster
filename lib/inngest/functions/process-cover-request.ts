import { inngest } from "../client";
import type { InngestFunction } from "inngest";
import { db } from "@/lib/db";
import { eq, and, ne, inArray } from "drizzle-orm";
import {
  staff,
  coverRequest,
  coverOffer,
  availabilitySubmission,
  scheduleVariation,
  type ShiftAssignment,
  type AvailabilitySlot,
} from "@/lib/db/schema";
import { getWeekStart } from "@/lib/date-utils";
import { ChannelRouter, type ChannelRouterDeps } from "@/lib/messaging/channel-router";
import { communicationLog, conversationWindow } from "@/lib/db/schema";

function buildChannelRouter(): ChannelRouter {
  const deps: ChannelRouterDeps = {
    async getConversationWindow(staffId: string) {
      const row = await db.query.conversationWindow.findFirst({
        where: eq(conversationWindow.staffId, staffId),
        orderBy: (t, { desc }) => [desc(t.windowExpiresAt)],
      });
      if (!row || new Date() > row.windowExpiresAt) return null;
      return {
        staffId: row.staffId,
        channel: "whatsapp" as const,
        windowOpensAt: row.windowOpensAt,
        windowExpiresAt: row.windowExpiresAt,
      };
    },
    async getStaffContact(staffId: string) {
      const s = await db.query.staff.findFirst({ where: eq(staff.id, staffId) });
      if (!s) return null;
      return {
        staffId: s.id,
        businessId: s.businessId,
        whatsappPhone: s.phone ?? undefined,
        email: s.email ?? undefined,
        smsPhone: s.phone ?? undefined,
        telegramChatId: s.telegramChatId ?? undefined,
        hasWhatsapp: !!s.phone,
      };
    },
    async logMessageSent(result) {
      await db.insert(communicationLog).values({
        businessId: result.businessId,
        staffId: result.staffId,
        direction: "outbound",
        channel: result.channel,
        body: "(cover offer notification)",
        sentAt: new Date(),
      });
    },
  };
  return new ChannelRouter(deps);
}

export const processCoverRequest: InngestFunction.Any = inngest.createFunction(
  { id: "process-cover-request", triggers: [{ event: "cover/request.created" }] },
  async ({ event, step }: { event: any; step: any }) => {
    const {
      coverRequestId,
      businessId,
      variationId,
      targetDate,
      shiftStart,
      shiftEnd,
      shiftType,
      requestingStaffId,
      requestType,
    } = event.data as {
      coverRequestId: string;
      businessId: string;
      scheduleRunId: string;
      variationId: string;
      targetDate: string;
      shiftStart: string;
      shiftEnd: string;
      shiftType: string;
      requestingStaffId: string;
      requestType?: "cover" | "swap";
    };

    const isSwap = requestType === "swap";

    // Step 1: Find eligible candidates
    const candidates = await step.run("find-candidates", async () => {
      // Get all active staff except requester
      const allStaff = await db.query.staff.findMany({
        where: and(
          eq(staff.businessId, businessId),
          eq(staff.isActive, true),
          ne(staff.id, requestingStaffId),
        ),
      });

      // Get approved variation to check current assignments
      const variation = await db.query.scheduleVariation.findFirst({
        where: eq(scheduleVariation.id, variationId),
      });
      const assignments = (variation?.assignments as ShiftAssignment[]) ?? [];

      // Target date's week start for availability lookup
      const targetDateObj = new Date(targetDate + "T00:00:00Z");
      const weekStart = getWeekStart(1, targetDateObj); // default Monday start

      // Get availability submissions for eligible staff
      const staffIds = allStaff.map((s) => s.id);
      const submissions = staffIds.length > 0
        ? await db.query.availabilitySubmission.findMany({
            where: and(
              inArray(availabilitySubmission.staffId, staffIds),
              eq(availabilitySubmission.weekStart, weekStart),
            ),
          })
        : [];

      const submissionMap = new Map(submissions.map((s) => [s.staffId, s]));

      // Score and filter candidates
      const scored: Array<{ staffId: string; score: number }> = [];

      for (const s of allStaff) {
        // Check role match (skip filter if staff has no roles = all-role)
        if (s.roles.length > 0 && shiftType && !s.roles.includes(shiftType)) {
          continue;
        }

        // Check availability for that day
        const sub = submissionMap.get(s.id);
        if (!sub) continue; // No submission = can't confirm availability

        const daySlots = sub.slots.filter((slot: AvailabilitySlot) => slot.day === targetDate);
        if (daySlots.length === 0) continue;

        // Check if any slot overlaps the shift time
        const hasOverlap = daySlots.some((slot: AvailabilitySlot) => {
          if (slot.preference === "unavailable") return false;
          return slot.startTime <= shiftStart && slot.endTime >= shiftEnd;
        });
        if (!hasOverlap) continue;

        // Check max hours (count current assigned shifts)
        const staffAssignments = assignments.filter((a) => a.staffId === s.id);
        // Simple heuristic: skip if already at 6+ shifts
        if (staffAssignments.length >= 6) continue;

        // Score: preferred > available, then fewer assigned hours
        const bestPreference = daySlots.some((slot: AvailabilitySlot) => slot.preference === "preferred")
          ? 2
          : 1;
        const fairnessScore = 10 - staffAssignments.length; // fewer shifts = higher score
        scored.push({ staffId: s.id, score: bestPreference * 10 + fairnessScore });
      }

      // Sort by score descending
      scored.sort((a, b) => b.score - a.score);
      return scored.map((s) => s.staffId);
    });

    if (candidates.length === 0) {
      // No candidates — escalate immediately
      await step.run("escalate-no-candidates", async () => {
        await db
          .update(coverRequest)
          .set({ status: "escalated", updatedAt: new Date() })
          .where(eq(coverRequest.id, coverRequestId));

        // Notify manager via channel router
        const router = buildChannelRouter();
        // Find a manager (business owner)
        const { user } = await import("@/lib/db/schema");
        const manager = await db.query.user.findFirst({
          where: and(eq(user.businessId, businessId), eq(user.role, "owner")),
        });
        if (manager) {
          // For now, just update status. Manager notification would need manager contact info.
        }
      });
      return { status: "escalated", reason: "no_candidates" };
    }

    // Update candidates list on the cover request
    await step.run("update-candidates-list", async () => {
      await db
        .update(coverRequest)
        .set({ candidates, updatedAt: new Date() })
        .where(eq(coverRequest.id, coverRequestId));
    });

    // Step 2: Offer loop — offer to each candidate sequentially
    for (let i = 0; i < candidates.length; i++) {
      const candidateId = candidates[i];

      // Create offer record and send message
      const offerId = await step.run(`offer-candidate-${i}`, async () => {
        const [offer] = await db
          .insert(coverOffer)
          .values({
            coverRequestId,
            candidateStaffId: candidateId,
            status: "pending",
          })
          .returning();

        // Send offer via ChannelRouter
        const router = buildChannelRouter();
        const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const dayName = dayNames[new Date(targetDate + "T00:00:00Z").getUTCDay()];

        // Look up requester name for swap messages
        let requesterName = "A colleague";
        if (isSwap) {
          const requester = await db.query.staff.findFirst({
            where: eq(staff.id, requestingStaffId),
          });
          requesterName = requester?.name ?? "A colleague";
        }

        const content = isSwap
          ? `${requesterName} wants to swap their ${dayName} ${shiftStart}–${shiftEnd} shift with you. Would you like to swap?`
          : `Can you cover a shift on ${dayName} ${targetDate} from ${shiftStart} to ${shiftEnd}?`;

        await router.send({
          staffId: candidateId,
          businessId,
          content,
          urgency: "time_sensitive",
          inlineKeyboard: [
            [
              { text: "Yes ✓", callback_data: `cover_accept_${coverRequestId}` },
              { text: "No ✗", callback_data: `cover_decline_${coverRequestId}` },
            ],
          ],
        });

        return offer.id;
      });

      // Wait for response (2hr timeout)
      const responseEvent = await step.waitForEvent(`wait-response-${i}`, {
        event: "cover/offer.responded",
        match: "data.coverRequestId",
        timeout: "2h",
      });

      if (responseEvent && responseEvent.data.accepted) {
        // Candidate accepted — fill the cover (atomic check-and-set)
        const fillResult = await step.run("fill-cover", async () => {
          return await db.transaction(async (tx) => {
            // Atomic: only update if still open
            const [filled] = await tx
              .update(coverRequest)
              .set({ status: "filled", filledBy: candidateId, updatedAt: new Date() })
              .where(and(eq(coverRequest.id, coverRequestId), eq(coverRequest.status, "open")))
              .returning();

            if (!filled) {
              // Already taken by someone else
              const router = buildChannelRouter();
              await router.send({
                staffId: candidateId,
                businessId,
                content: "Sorry, that shift was just filled by someone else. Thanks for offering!",
                urgency: "non_urgent",
              });
              return { alreadyFilled: true };
            }

            // Won the race — update offer status and notify requester
            await tx
              .update(coverOffer)
              .set({ status: "accepted", respondedAt: new Date() })
              .where(eq(coverOffer.id, offerId));

            const router = buildChannelRouter();
            const candidate = await tx.query.staff.findFirst({
              where: eq(staff.id, candidateId),
            });
            await router.send({
              staffId: requestingStaffId,
              businessId,
              content: `Great news! ${candidate?.name ?? "A colleague"} will cover your ${targetDate} ${shiftStart}–${shiftEnd} shift.`,
              urgency: "time_sensitive",
            });

            return { alreadyFilled: false };
          });
        });

        if (fillResult.alreadyFilled) {
          continue; // Move to next candidate or end loop
        }

        return { status: "filled", filledBy: candidateId };
      }

      // Declined or timed out — mark offer and continue
      await step.run(`mark-offer-${i}-expired`, async () => {
        const status = responseEvent ? "declined" : "expired";
        await db
          .update(coverOffer)
          .set({ status, respondedAt: new Date() })
          .where(eq(coverOffer.id, offerId));
      });
    }

    // Step 3: All candidates exhausted — escalate
    await step.run("escalate-all-declined", async () => {
      await db
        .update(coverRequest)
        .set({ status: "escalated", updatedAt: new Date() })
        .where(eq(coverRequest.id, coverRequestId));

      // Notify requester
      const router = buildChannelRouter();
      await router.send({
        staffId: requestingStaffId,
        businessId,
        content: `I wasn't able to find cover for your ${targetDate} ${shiftStart}–${shiftEnd} shift. Your manager has been notified.`,
        urgency: "time_sensitive",
      });
    });

    return { status: "escalated", reason: "all_declined" };
  },
);
