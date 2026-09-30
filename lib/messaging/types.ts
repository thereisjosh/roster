export type Channel = "whatsapp_reply" | "email" | "whatsapp_template" | "sms" | "telegram";

export type MessageUrgency = "critical" | "time_sensitive" | "non_urgent";

export interface StaffContact {
  staffId: string;
  businessId: string;
  whatsappPhone?: string;
  email?: string;
  smsPhone?: string;
  telegramChatId?: string;
  hasWhatsapp: boolean;
}

export interface ConversationWindow {
  staffId: string;
  channel: "whatsapp";
  windowOpensAt: Date;
  windowExpiresAt: Date;
}

export interface SendMessageRequest {
  staffId: string;
  businessId: string;
  content: string;
  urgency: MessageUrgency;
  templateName?: string;
  templateParams?: Record<string, string>;
  subject?: string; // for email
  inlineKeyboard?: TelegramInlineButton[][]; // for telegram
}

export interface TelegramInlineButton {
  text: string;
  callback_data: string;
}

export interface SendResult {
  success: boolean;
  channel: Channel;
  messageId?: string;
  cost: number;
  error?: string;
}

export interface ChannelAdapter {
  send(request: SendMessageRequest, contact: StaffContact): Promise<SendResult>;
}

/** Cost per message by channel in USD */
export const CHANNEL_COSTS: Record<Channel, number> = {
  telegram: 0.0,
  whatsapp_reply: 0.0,
  email: 0.0001,
  whatsapp_template: 0.0113,
  sms: 0.052,
};
