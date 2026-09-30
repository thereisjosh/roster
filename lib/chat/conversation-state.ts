import { eq, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversationState } from "@/lib/db/schema";

const EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

export interface PendingState {
  staffId: string;
  pendingTool: string;
  pendingParams: Record<string, any>;
  pendingPrompt: string;
  channel: string;
  expiresAt: Date;
}

/**
 * Fetch pending conversation state for a staff member.
 * Returns null if no state or expired (and cleans up expired row).
 */
export async function getPendingState(
  staffId: string,
): Promise<PendingState | null> {
  const row = await db.query.conversationState.findFirst({
    where: eq(conversationState.staffId, staffId),
  });

  if (!row) return null;

  if (new Date() > row.expiresAt) {
    await db
      .delete(conversationState)
      .where(eq(conversationState.staffId, staffId));
    return null;
  }

  return {
    staffId: row.staffId,
    pendingTool: row.pendingTool,
    pendingParams: row.pendingParams,
    pendingPrompt: row.pendingPrompt,
    channel: row.channel,
    expiresAt: row.expiresAt,
  };
}

/**
 * Upsert conversation state with a 10-minute expiry.
 */
export async function setState(
  staffId: string,
  tool: string,
  params: Record<string, any>,
  pendingPrompt: string,
  channel: string,
): Promise<void> {
  const expiresAt = new Date(Date.now() + EXPIRY_MS);

  await db
    .insert(conversationState)
    .values({
      staffId,
      pendingTool: tool,
      pendingParams: params,
      pendingPrompt,
      channel,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: conversationState.staffId,
      set: {
        pendingTool: tool,
        pendingParams: params,
        pendingPrompt: pendingPrompt,
        channel,
        expiresAt,
        createdAt: new Date(),
      },
    });
}

/**
 * Clear conversation state for a staff member.
 */
export async function clearState(staffId: string): Promise<void> {
  await db
    .delete(conversationState)
    .where(eq(conversationState.staffId, staffId));
}
