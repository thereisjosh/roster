import type { ChannelAdapter, SendMessageRequest, SendResult, StaffContact } from "../types";

/**
 * Meta Cloud API direct integration (no BSP like Twilio).
 * Saves $0.005/msg markup that Twilio charges on every message.
 *
 * Conversation window tracking:
 * - When staff messages the bot, record window_opens_at = now, window_expires_at = now + 24hrs
 * - Free reply messages (within window) cost $0.00
 * - Template messages (outside window) cost $0.0113 (utility category, SG pricing)
 */

const WHATSAPP_API_VERSION = "v21.0";

interface WhatsAppApiResponse {
  messaging_product: string;
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string }>;
}

export class WhatsAppAdapter implements ChannelAdapter {
  private phoneNumberId: string;
  private accessToken: string;
  private baseUrl: string;

  constructor() {
    this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";
    this.accessToken = process.env.WHATSAPP_ACCESS_TOKEN ?? "";
    this.baseUrl = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${this.phoneNumberId}/messages`;
  }

  async send(request: SendMessageRequest, contact: StaffContact): Promise<SendResult> {
    if (!contact.whatsappPhone) {
      return { success: false, channel: "whatsapp_reply", cost: 0, error: "No WhatsApp phone" };
    }

    try {
      const body = request.templateName
        ? this.buildTemplateMessage(contact.whatsappPhone, request)
        : this.buildTextMessage(contact.whatsappPhone, request.content);

      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.text();
        return {
          success: false,
          channel: request.templateName ? "whatsapp_template" : "whatsapp_reply",
          cost: 0,
          error: `WhatsApp API error ${response.status}: ${error}`,
        };
      }

      const data = (await response.json()) as WhatsAppApiResponse;
      const channel = request.templateName ? "whatsapp_template" : "whatsapp_reply";
      const cost = channel === "whatsapp_template" ? 0.0113 : 0.0;

      return {
        success: true,
        channel,
        messageId: data.messages[0]?.id,
        cost,
      };
    } catch (err) {
      return {
        success: false,
        channel: "whatsapp_reply",
        cost: 0,
        error: err instanceof Error ? err.message : "Unknown WhatsApp error",
      };
    }
  }

  private buildTextMessage(to: string, text: string) {
    return {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    };
  }

  private buildTemplateMessage(to: string, request: SendMessageRequest) {
    return {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: request.templateName,
        language: { code: "en" },
        components: request.templateParams
          ? [
              {
                type: "body",
                parameters: Object.values(request.templateParams).map((value) => ({
                  type: "text",
                  text: value,
                })),
              },
            ]
          : [],
      },
    };
  }
}
