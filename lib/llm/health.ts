/**
 * In-memory sliding-window health tracker for LLM models.
 * Tracks recent error rates and latency per model+task to enable
 * health-aware model selection in callWithFallback.
 */

interface CallRecord {
  success: boolean;
  latencyMs: number;
  timestamp: number;
}

export class ModelHealthTracker {
  private windows = new Map<string, CallRecord[]>();
  private windowMs: number;

  constructor(windowMs = 5 * 60 * 1000) {
    this.windowMs = windowMs;
  }

  private key(model: string, taskType: string): string {
    return `${model}::${taskType}`;
  }

  private evict(records: CallRecord[], now: number): CallRecord[] {
    const cutoff = now - this.windowMs;
    return records.filter((r) => r.timestamp >= cutoff);
  }

  record(model: string, taskType: string, success: boolean, latencyMs: number): void {
    const k = this.key(model, taskType);
    const now = Date.now();
    const records = this.evict(this.windows.get(k) ?? [], now);
    records.push({ success, latencyMs, timestamp: now });
    this.windows.set(k, records);
  }

  getHealth(
    model: string,
    taskType: string,
  ): { errorRate: number; p95LatencyMs: number; sampleSize: number } {
    const k = this.key(model, taskType);
    const records = this.evict(this.windows.get(k) ?? [], Date.now());
    this.windows.set(k, records);

    if (records.length === 0) {
      return { errorRate: 0, p95LatencyMs: 0, sampleSize: 0 };
    }

    const failures = records.filter((r) => !r.success).length;
    const errorRate = failures / records.length;

    const sorted = records.map((r) => r.latencyMs).sort((a, b) => a - b);
    const p95Index = Math.min(Math.ceil(records.length * 0.95) - 1, records.length - 1);
    const p95LatencyMs = sorted[p95Index];

    return { errorRate, p95LatencyMs, sampleSize: records.length };
  }

  isHealthy(
    model: string,
    taskType: string,
    maxErrorRate = 0.3,
    maxP95Ms = 10_000,
  ): boolean {
    const { errorRate, p95LatencyMs, sampleSize } = this.getHealth(model, taskType);
    if (sampleSize === 0) return true; // optimistic default
    return errorRate < maxErrorRate && p95LatencyMs < maxP95Ms;
  }
}

/** Singleton instance */
export const modelHealth = new ModelHealthTracker();
