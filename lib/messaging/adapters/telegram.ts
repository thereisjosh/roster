import type { ChannelAdapter, SendMessageRequest, SendResult, StaffContact } from "../types";

/**
 * Telegram Bot API adapter.
 * Cost: $0.00 per message — Telegram is completely free.
 * Requires TELEGRAM_BOT_TOKEN env var.
 */

interface TelegramSendMessageResponse {
  ok: boolean;
  result?: { message_id: number };
  description?: string;
}

export class TelegramAdapter implements ChannelAdapter {
  private botToken: string;
  private baseUrl: string;

  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN ?? "";
    this.baseUrl = `https://api.telegram.org/bot${this.botToken}`;
  }

  async send(request: SendMessageRequest, contact: StaffContact): Promise<SendResult> {
    if (!contact.telegramChatId) {
      return { success: false, channel: "telegram", cost: 0, error: "No Telegram chat ID" };
    }

    try {
      const body: Record<string, unknown> = {
        chat_id: contact.telegramChatId,
        text: request.content,
        parse_mode: "HTML",
      };

      if (request.inlineKeyboard) {
        body.reply_markup = {
          inline_keyboard: request.inlineKeyboard,
        };
      }

      const response = await fetch(`${this.baseUrl}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = (await response.json()) as TelegramSendMessageResponse;

      if (!data.ok) {
        return {
          success: false,
          channel: "telegram",
          cost: 0,
          error: `Telegram API error: ${data.description}`,
        };
      }

      return {
        success: true,
        channel: "telegram",
        messageId: String(data.result?.message_id),
        cost: 0.0,
      };
    } catch (err) {
      return {
        success: false,
        channel: "telegram",
        cost: 0,
        error: err instanceof Error ? err.message : "Unknown Telegram error",
      };
    }
  }
}
