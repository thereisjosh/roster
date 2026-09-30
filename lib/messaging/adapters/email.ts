import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import type { ChannelAdapter, SendMessageRequest, SendResult, StaffContact } from "../types";

/**
 * AWS SES adapter — $0.10 per 1,000 emails ($0.0001 each).
 * Used for non-urgent bulk: weekly schedule PDFs, preference confirmations, analytics summaries.
 */
export class EmailAdapter implements ChannelAdapter {
  private client: SESClient;
  private fromAddress: string;

  constructor() {
    this.client = new SESClient({
      region: process.env.AWS_SES_REGION ?? "ap-southeast-1",
    });
    this.fromAddress = process.env.SES_FROM_ADDRESS ?? "roster@example.com";
  }

  async send(request: SendMessageRequest, contact: StaffContact): Promise<SendResult> {
    if (!contact.email) {
      return { success: false, channel: "email", cost: 0, error: "No email address" };
    }

    try {
      const command = new SendEmailCommand({
        Source: this.fromAddress,
        Destination: { ToAddresses: [contact.email] },
        Message: {
          Subject: { Data: request.subject ?? "Roster Update" },
          Body: {
            Text: { Data: request.content },
          },
        },
      });

      const response = await this.client.send(command);

      return {
        success: true,
        channel: "email",
        messageId: response.MessageId,
        cost: 0.0001,
      };
    } catch (err) {
      return {
        success: false,
        channel: "email",
        cost: 0,
        error: err instanceof Error ? err.message : "Unknown SES error",
      };
    }
  }
}
