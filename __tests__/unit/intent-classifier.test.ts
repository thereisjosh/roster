import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/llm", () => ({
  callWithFallback: vi.fn(),
}));

import { classifyIntent } from "@/lib/availability/intent-classifier";
import { callWithFallback } from "@/lib/llm";

const mockCallWithFallback = vi.mocked(callWithFallback);

describe("classifyIntent", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("parses LLM JSON response → correct intent + confidence", async () => {
    mockCallWithFallback.mockResolvedValue({
      content: JSON.stringify({ intent: "availability_update", confidence: 0.95 }),
    } as never);

    const result = await classifyIntent("I can work Monday 9-5", "b1");

    expect(result).toEqual({ intent: "availability_update", confidence: 0.95 });
  });

  it("handles deterministic fallback format (includes method field)", async () => {
    mockCallWithFallback.mockResolvedValue({
      content: JSON.stringify({ intent: "confirmation", confidence: 0.8, method: "deterministic" }),
    } as never);

    const result = await classifyIntent("yes", "b1");

    expect(result).toEqual({ intent: "confirmation", confidence: 0.8 });
  });

  it('returns {intent: "unknown", confidence: 0} on malformed JSON', async () => {
    mockCallWithFallback.mockResolvedValue({
      content: "not valid json {{{",
    } as never);

    const result = await classifyIntent("random gibberish", "b1");

    expect(result).toEqual({ intent: "unknown", confidence: 0 });
  });

  it('passes taskType: "classification" and jsonMode: true to callWithFallback', async () => {
    mockCallWithFallback.mockResolvedValue({
      content: JSON.stringify({ intent: "unknown", confidence: 0.5 }),
    } as never);

    await classifyIntent("hello", "b1");

    expect(mockCallWithFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: "classification",
        jsonMode: true,
        businessId: "b1",
        prompt: "hello",
      }),
    );
  });

  it("defaults confidence to 0.6 when not a number", async () => {
    mockCallWithFallback.mockResolvedValue({
      content: JSON.stringify({ intent: "swap_request", confidence: "high" }),
    } as never);

    const result = await classifyIntent("can I swap?", "b1");

    expect(result).toEqual({ intent: "swap_request", confidence: 0.6 });
  });
});
