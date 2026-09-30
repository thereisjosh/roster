import { inngest } from "../client";
import type { InngestFunction } from "inngest";
import { db } from "@/lib/db";
import { eq, and, ne, like } from "drizzle-orm";
import {
  business,
  staff,
  availabilitySubmission,
  communicationLog,
  conversationWindow,
  type BusinessConfig,
} from "@/lib/db/schema";
import { getWeekStart, formatWeekRange } from "@/lib/date-utils";
import { getDefaultConfig } from "@/lib/config-defaults";
import { ChannelRouter, type ChannelRouterDeps } from "@/lib/messaging/channel-router";
import { createLogger } from "@/lib/logging";

const logger = createLogger("send-reminders");

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
        body: "(availability reminder)",
        sentAt: new Date(),
      });
    },
  };
  return new ChannelRouter(deps);
}

export const sendReminders: InngestFunction.Any = inngest.createFunction(
  {
    id: "send-reminders",
    triggers: [{ cron: "0 * * * *" }], // hourly
  },
  async ({ step }: { step: any }) => {
    const businesses = await step.run("load-businesses", async () => {
      return db.query.business.findMany();
    });

    let totalSent = 0;

    for (const biz of businesses) {
      const config: BusinessConfig = biz.config ?? getDefaultConfig();
      const weekStartDay = config.weekStartDay ?? 1;

      // Compute this week's availability deadline
      const now = new Date();
      const weekStart = getWeekStart(weekStartDay);
      const weekStartStr = weekStart.toISOString().slice(0, 10);

      // Deadline: weekStartDay offset by deadlineDay, at deadlineHour
      const deadlineDay = config.availabilityDeadlineDay ?? weekStartDay;
      const deadlineHour = config.availabilityDeadlineHour ?? 18;

      // Calculate deadline date: find next occurrence of deadlineDay from weekStart
      const daysUntilDeadline = (deadlineDay - weekStartDay + 7) % 7;
      const deadlineDate = new Date(weekStart);
      deadlineDate.setUTCDate(deadlineDate.getUTCDate() + daysUntilDeadline);
      deadlineDate.setUTCHours(deadlineHour, 0, 0, 0);

      // Hours until deadline
      const hoursUntilDeadline = (deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60);

      // Check if any reminderIntervals match (within 1h window)
      const intervals = config.reminderIntervals ?? [48, 24, 2];
      const matchingInterval = intervals.find(
        (h) => Math.abs(hoursUntilDeadline - h) < 1,
      );
      if (matchingInterval === undefined) continue;

      // Find active staff without confirmed submission for this week
      const sent = await step.run(`remind-${biz.id}`, async () => {
        const activeStaff = await db.query.staff.findMany({
          where: and(
            eq(staff.businessId, biz.id),
            eq(staff.isActive, true),
          ),
        });

        const submissions = await db.query.availabilitySubmission.findMany({
          where: eq(availabilitySubmission.weekStart, weekStart),
        });

        const confirmedStaffIds = new Set(
          submissions
            .filter((s) => s.status === "confirmed")
            .map((s) => s.staffId),
        );

        const router = buildChannelRouter();
        const weekLabel = formatWeekRange(weekStart);
        let count = 0;

        for (const s of activeStaff) {
          if (confirmedStaffIds.has(s.id)) continue;

          // Dedup check: look for existing reminder log with this interval+week
          const dedupTag = `reminder:${matchingInterval}h:${weekStartStr}`;
          const existing = await db.query.communicationLog.findFirst({
            where: and(
              eq(communicationLog.staffId, s.id),
              eq(communicationLog.body, dedupTag),
            ),
          });
          if (existing) continue;

          // Send reminder
          const hasSubmitted = submissions.some((sub) => sub.staffId === s.id);
          const content = hasSubmitted
            ? `Reminder: Please confirm your availability for ${weekLabel}. You submitted but haven't confirmed yet.`
            : `Reminder: Please submit your availability for ${weekLabel}. The deadline is in about ${matchingInterval} hours.`;

          try {
            await router.send({
              staffId: s.id,
              businessId: biz.id,
              content,
              urgency: matchingInterval <= 2 ? "time_sensitive" : "non_urgent",
            });

            // Log dedup tag
            await db.insert(communicationLog).values({
              businessId: biz.id,
              staffId: s.id,
              direction: "outbound",
              channel: "telegram", // logged generically
              body: dedupTag,
              sentAt: new Date(),
            });
            count++;
          } catch (err) {
            logger.error({ err, staffId: s.id }, "failed to send reminder");
          }
        }

        return count;
      });

      totalSent += sent;
    }

    logger.info({ totalSent }, "reminder run complete");
    return { totalSent };
  },
);
