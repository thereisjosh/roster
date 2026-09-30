import type { ChannelAdapter, SendMessageRequest, SendResult, StaffContact } from "../types";

/**
 * Plivo SMS adapter — $0.052 per message (Singapore).
 * Last-resort channel for staff not on WhatsApp.
 * Requires Singapore SSIR registration (S$545 setup + S$218/year).
 * Target: <5% of total messages.
 */

interface PlivoMessageResponse {
  api_id: string;
  message: string;
  message_uuid: string[];
}

export class SmsAdapter implements ChannelAdapter {
  private authId: string;
  private authToken: string;
  private sourceNumber: string;
  private baseUrl: string;

  constructor() {
    this.authId = process.env.PLIVO_AUTH_ID ?? "";
    this.authToken = process.env.PLIVO_AUTH_TOKEN ?? "";
    this.sourceNumber = process.env.PLIVO_SOURCE_NUMBER ?? "";
    this.baseUrl = `https://api.plivo.com/v1/Account/${this.authId}/Message/`;
  }

  async send(request: SendMessageRequest, contact: StaffContact): Promise<SendResult> {
    if (!contact.smsPhone) {
      return { success: false, channel: "sms", cost: 0, error: "No SMS phone number" };
    }

    try {
      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: {
          Authorization: "Basic " + btoa(`${this.authId}:${this.authToken}`),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          src: this.sourceNumber,
          dst: contact.smsPhone,
          text: request.content,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return {
          success: false,
          channel: "sms",
          cost: 0,
          error: `Plivo API error ${response.status}: ${error}`,
        };
      }

      const data = (await response.json()) as PlivoMessageResponse;

      return {
        success: true,
        channel: "sms",
        messageId: data.message_uuid[0],
        cost: 0.052,
      };
    } catch (err) {
      return {
        success: false,
        channel: "sms",
        cost: 0,
        error: err instanceof Error ? err.message : "Unknown Plivo error",
      };
    }
  }
}
