import { describe, it, expect, beforeEach, vi } from "vitest";
import { ModelHealthTracker } from "@/lib/llm/health";

describe("ModelHealthTracker", () => {
  let tracker: ModelHealthTracker;

  beforeEach(() => {
    tracker = new ModelHealthTracker(5 * 60 * 1000); // 5 min window
  });

  it("returns healthy for empty window (optimistic default)", () => {
    expect(tracker.isHealthy("gpt-4.1-nano", "message_routing")).toBe(true);
  });

  it("returns healthy when all calls succeed with low latency", () => {
    for (let i = 0; i < 10; i++) {
      tracker.record("gpt-4.1-nano", "message_routing", true, 200);
    }
    expect(tracker.isHealthy("gpt-4.1-nano", "message_routing")).toBe(true);
  });

  it("returns unhealthy when error rate exceeds threshold", () => {
    // 4 failures out of 10 = 40% > 30% default threshold
    for (let i = 0; i < 6; i++) {
      tracker.record("gpt-4.1-nano", "message_routing", true, 200);
    }
    for (let i = 0; i < 4; i++) {
      tracker.record("gpt-4.1-nano", "message_routing", false, 0);
    }
    expect(tracker.isHealthy("gpt-4.1-nano", "message_routing")).toBe(false);
  });

  it("returns unhealthy when p95 latency exceeds threshold", () => {
    // 8 fast calls + 2 slow calls = 20% slow; p95 index lands on a slow one
    for (let i = 0; i < 8; i++) {
      tracker.record("gpt-4.1-nano", "message_routing", true, 200);
    }
    for (let i = 0; i < 2; i++) {
      tracker.record("gpt-4.1-nano", "message_routing", true, 15_000);
    }
    expect(tracker.isHealthy("gpt-4.1-nano", "message_routing")).toBe(false);
  });

  it("calculates error rate correctly", () => {
    tracker.record("model-a", "task-a" as any, true, 100);
    tracker.record("model-a", "task-a" as any, false, 100);
    tracker.record("model-a", "task-a" as any, true, 100);
    tracker.record("model-a", "task-a" as any, false, 100);

    const health = tracker.getHealth("model-a", "task-a");
    expect(health.errorRate).toBe(0.5);
    expect(health.sampleSize).toBe(4);
  });

  it("evicts entries older than window", () => {
    const shortTracker = new ModelHealthTracker(1000); // 1 second window

    // Record a failure
    shortTracker.record("model-a", "task-a" as any, false, 100);

    // Mock Date.now to advance past window
    const originalNow = Date.now;
    vi.spyOn(Date, "now").mockReturnValue(originalNow() + 2000);

    // Old failure should be evicted — empty window = healthy
    expect(shortTracker.isHealthy("model-a", "task-a" as any)).toBe(true);
    const health = shortTracker.getHealth("model-a", "task-a");
    expect(health.sampleSize).toBe(0);

    vi.restoreAllMocks();
  });

  it("tracks different model+task combinations independently", () => {
    // model-a is unhealthy for task-a
    for (let i = 0; i < 10; i++) {
      tracker.record("model-a", "task-a" as any, false, 100);
    }
    // model-a is healthy for task-b
    for (let i = 0; i < 10; i++) {
      tracker.record("model-a", "task-b" as any, true, 100);
    }

    expect(tracker.isHealthy("model-a", "task-a" as any)).toBe(false);
    expect(tracker.isHealthy("model-a", "task-b" as any)).toBe(true);
  });

  it("respects custom thresholds", () => {
    // 20% error rate
    for (let i = 0; i < 8; i++) {
      tracker.record("model-a", "task-a" as any, true, 100);
    }
    for (let i = 0; i < 2; i++) {
      tracker.record("model-a", "task-a" as any, false, 100);
    }

    // Default 30% threshold — healthy
    expect(tracker.isHealthy("model-a", "task-a" as any)).toBe(true);
    // Stricter 10% threshold — unhealthy
    expect(tracker.isHealthy("model-a", "task-a" as any, 0.1)).toBe(false);
  });
});
