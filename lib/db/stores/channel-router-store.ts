import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  staff,
  conversationWindow,
  communicationLog,
} from "@/lib/db/schema";
import type { ChannelRouterDeps } from "@/lib/messaging/channel-router";
import type {
  ConversationWindow,
  StaffContact,
  SendResult,
  Channel,
} from "@/lib/messaging/types";

export class DrizzleChannelRouterStore implements ChannelRouterDeps {
  async getConversationWindow(
    staffId: string,
  ): Promise<ConversationWindow | null> {
    const row = await db.query.conversationWindow.findFirst({
      where: eq(conversationWindow.staffId, staffId),
      orderBy: (w, { desc }) => [desc(w.windowExpiresAt)],
    });

    if (!row) return null;

    return {
      staffId: row.staffId,
      channel: "whatsapp",
      windowOpensAt: row.windowOpensAt,
      windowExpiresAt: row.windowExpiresAt,
    };
  }

  async getStaffContact(staffId: string): Promise<StaffContact | null> {
    const row = await db.query.staff.findFirst({
      where: eq(staff.id, staffId),
    });

    if (!row) return null;

    return {
      staffId: row.id,
      businessId: row.businessId,
      whatsappPhone: row.phone ?? undefined,
      email: row.email ?? undefined,
      smsPhone: row.phone ?? undefined,
      telegramChatId: row.telegramChatId ?? undefined,
      hasWhatsapp: !!row.phone,
    };
  }

  async logMessageSent(
    result: SendResult & {
      staffId: string;
      businessId: string;
      channel: Channel;
    },
  ): Promise<void> {
    await db.insert(communicationLog).values({
      businessId: result.businessId,
      staffId: result.staffId,
      direction: "outbound",
      channel: result.channel,
      body: result.messageId ?? "",
      sentAt: new Date(),
    });
  }
}
