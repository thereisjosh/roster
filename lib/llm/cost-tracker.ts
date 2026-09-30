import type { LlmCallLog, LlmResponse, LlmRequest } from "./types";

/**
 * Per-call cost logging.
 * Every LLM call is logged to the llm_call_logs table for cost monitoring and eval.
 *
 * Table schema:
 *   id            UUID PRIMARY KEY
 *   business_id   TEXT NOT NULL
 *   task_type     TEXT NOT NULL
 *   model         TEXT NOT NULL
 *   input_tokens  INTEGER NOT NULL
 *   output_tokens INTEGER NOT NULL
 *   cost_usd      REAL NOT NULL
 *   latency_ms    INTEGER NOT NULL
 *   success       BOOLEAN NOT NULL
 *   error         TEXT
 *   created_at    TIMESTAMP DEFAULT NOW()
 */

export interface CostTrackerStore {
  insertCallLog(log: LlmCallLog): Promise<void>;
  getCallLogs(businessId: string, since: Date): Promise<LlmCallLog[]>;
  getTotalCost(businessId: string, since: Date): Promise<number>;
}

export class CostTracker {
  constructor(private store: CostTrackerStore) {}

  async logCall(request: LlmRequest, response: LlmResponse, success: boolean, error?: string): Promise<void> {
    await this.store.insertCallLog({
      businessId: request.businessId,
      taskType: request.taskType,
      model: response.model,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      costUsd: response.costUsd,
      latencyMs: response.latencyMs,
      success,
      error,
      createdAt: new Date(),
    });
  }

  async getMonthlyCost(businessId: string): Promise<{ totalUsd: number; byTask: Record<string, number> }> {
    const since = new Date();
    since.setDate(1);
    since.setHours(0, 0, 0, 0);

    const logs = await this.store.getCallLogs(businessId, since);
    const byTask: Record<string, number> = {};

    let totalUsd = 0;
    for (const log of logs) {
      totalUsd += log.costUsd;
      byTask[log.taskType] = (byTask[log.taskType] ?? 0) + log.costUsd;
    }

    return { totalUsd, byTask };
  }

  async checkCostThreshold(
    businessId: string,
    thresholdUsd: number,
  ): Promise<{ exceeded: boolean; currentUsd: number }> {
    const since = new Date();
    since.setDate(1);
    since.setHours(0, 0, 0, 0);

    const currentUsd = await this.store.getTotalCost(businessId, since);
    return { exceeded: currentUsd > thresholdUsd, currentUsd };
  }
}
