import { db } from "@/lib/db";
import { processedWebhookMessage } from "@/lib/db/schema";

/**
 * Returns true if this message was already processed (duplicate).
 * Uses INSERT with unique PK — concurrent duplicates get a unique violation.
 */
export async function isAlreadyProcessed(messageId: string, channel: string): Promise<boolean> {
  try {
    await db.insert(processedWebhookMessage).values({
      id: `${channel}:${messageId}`,
      channel,
      processedAt: new Date(),
    });
    return false; // Insert succeeded → first time
  } catch (e: any) {
    if (e.code === "23505") return true; // Unique violation → already processed
    throw e;
  }
}
