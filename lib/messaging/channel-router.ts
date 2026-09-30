import type {
  Channel,
  ConversationWindow,
  SendMessageRequest,
  SendResult,
  StaffContact,
} from "./types";
import { WhatsAppAdapter } from "./adapters/whatsapp";
import { EmailAdapter } from "./adapters/email";
import { SmsAdapter } from "./adapters/sms";
import { TelegramAdapter } from "./adapters/telegram";

export interface ChannelRouterDeps {
  getConversationWindow(staffId: string): Promise<ConversationWindow | null>;
  getStaffContact(staffId: string): Promise<StaffContact | null>;
  logMessageSent(result: SendResult & { staffId: string; businessId: string; channel: Channel }): Promise<void>;
}

/**
 * Channel selection logic — cheapest viable channel for each message.
 *
 * Priority (cheapest first):
 * 1. Telegram              — $0.00  — staff has linked Telegram
 * 2. WhatsApp free reply   — $0.00  — staff messaged bot within 24hrs
 * 3. Email (AWS SES)       — $0.0001 — non-urgent bulk
 * 4. WhatsApp template     — $0.0113 — time-sensitive, no open window
 * 5. SMS (Plivo)           — $0.052  — critical fallback
 */
export class ChannelRouter {
  private whatsapp: WhatsAppAdapter;
  private email: EmailAdapter;
  private sms: SmsAdapter;
  private telegram: TelegramAdapter;

  constructor(private deps: ChannelRouterDeps) {
    this.whatsapp = new WhatsAppAdapter();
    this.email = new EmailAdapter();
    this.sms = new SmsAdapter();
    this.telegram = new TelegramAdapter();
  }

  async send(request: SendMessageRequest): Promise<SendResult> {
    const contact = await this.deps.getStaffContact(request.staffId);
    if (!contact) {
      return { success: false, channel: "email", cost: 0, error: "Staff contact not found" };
    }

    const channel = await this.selectChannel(request, contact);
    const result = await this.dispatch(channel, request, contact);

    await this.deps.logMessageSent({
      ...result,
      staffId: request.staffId,
      businessId: request.businessId,
      channel,
    });

    return result;
  }

  async selectChannel(request: SendMessageRequest, contact: StaffContact): Promise<Channel> {
    // 1. Telegram — free, if staff has linked their account
    if (contact.telegramChatId) {
      return "telegram";
    }

    // 2. Check for free WhatsApp reply window
    if (contact.hasWhatsapp && contact.whatsappPhone) {
      const window = await this.deps.getConversationWindow(request.staffId);
      if (window && new Date() < window.windowExpiresAt) {
        return "whatsapp_reply";
      }
    }

    // 3. Non-urgent → email (cheapest paid channel)
    if (request.urgency === "non_urgent" && contact.email) {
      return "email";
    }

    // 4. Time-sensitive or critical with WhatsApp → template message
    if (contact.hasWhatsapp && contact.whatsappPhone) {
      return "whatsapp_template";
    }

    // 5. Has email and is time-sensitive (not critical) → email as fallback
    if (request.urgency === "time_sensitive" && contact.email) {
      return "email";
    }

    // 6. Critical fallback → SMS
    if (contact.smsPhone) {
      return "sms";
    }

    // 7. Last resort — email if available
    if (contact.email) {
      return "email";
    }

    // No channel available — will return error in dispatch
    return "email";
  }

  private async dispatch(
    channel: Channel,
    request: SendMessageRequest,
    contact: StaffContact,
  ): Promise<SendResult> {
    switch (channel) {
      case "telegram":
        return this.telegram.send(request, contact);
      case "whatsapp_reply":
      case "whatsapp_template":
        return this.whatsapp.send(request, contact);
      case "email":
        return this.email.send(request, contact);
      case "sms":
        return this.sms.send(request, contact);
    }
  }
}
