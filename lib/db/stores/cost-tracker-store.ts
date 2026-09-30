import { eq, gte, and, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { llmCallLog } from "@/lib/db/schema";
import type { CostTrackerStore } from "@/lib/llm/cost-tracker";
import type { LlmCallLog } from "@/lib/llm/types";

export class DrizzleCostTrackerStore implements CostTrackerStore {
  async insertCallLog(log: LlmCallLog): Promise<void> {
    await db.insert(llmCallLog).values({
      businessId: log.businessId,
      taskType: log.taskType,
      model: log.model,
      inputTokens: log.inputTokens,
      outputTokens: log.outputTokens,
      costUsd: log.costUsd,
      latencyMs: log.latencyMs,
      success: log.success,
      error: log.error,
    });
  }

  async getCallLogs(businessId: string, since: Date): Promise<LlmCallLog[]> {
    const rows = await db
      .select()
      .from(llmCallLog)
      .where(
        and(
          eq(llmCallLog.businessId, businessId),
          gte(llmCallLog.createdAt, since),
        ),
      );

    return rows.map((row) => ({
      id: row.id,
      businessId: row.businessId,
      taskType: row.taskType as LlmCallLog["taskType"],
      model: row.model,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      costUsd: row.costUsd,
      latencyMs: row.latencyMs,
      success: row.success,
      error: row.error ?? undefined,
      createdAt: row.createdAt,
    }));
  }

  async getTotalCost(businessId: string, since: Date): Promise<number> {
    const [result] = await db
      .select({ total: sql<number>`coalesce(sum(${llmCallLog.costUsd}), 0)` })
      .from(llmCallLog)
      .where(
        and(
          eq(llmCallLog.businessId, businessId),
          gte(llmCallLog.createdAt, since),
        ),
      );
    return Number(result.total);
  }
}
