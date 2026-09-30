import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/llm", () => ({
  callWithFallback: vi.fn(),
}));

import { routeMessage } from "@/lib/chat/router";
import { callWithFallback } from "@/lib/llm";

const mockCallWithFallback = vi.mocked(callWithFallback);

const baseContext = {
  today: "2026-05-03",
  hasPendingOffer: false,
  hasUnconfirmedSubmission: false,
};

describe("routeMessage — missing params", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns missing array when LLM reports missing params", async () => {
    mockCallWithFallback.mockResolvedValue({
      content: JSON.stringify({
        tool: "request_cover",
        params: {},
        missing: ["date"],
      }),
    } as never);

    const result = await routeMessage("I can't come in", baseContext, "b1");

    expect(result.tool).toBe("request_cover");
    expect(result.params).toEqual({});
    expect(result.missing).toEqual(["date"]);
  });

  it("returns undefined missing when LLM omits it", async () => {
    mockCallWithFallback.mockResolvedValue({
      content: JSON.stringify({
        tool: "request_cover",
        params: { date: "2026-05-04" },
      }),
    } as never);

    const result = await routeMessage("I can't make it tomorrow", baseContext, "b1");

    expect(result.tool).toBe("request_cover");
    expect(result.params).toEqual({ date: "2026-05-04" });
    expect(result.missing).toBeUndefined();
  });

  it("returns empty missing array when LLM sends one", async () => {
    mockCallWithFallback.mockResolvedValue({
      content: JSON.stringify({
        tool: "query_schedule",
        params: {},
        missing: [],
      }),
    } as never);

    const result = await routeMessage("when do I work", baseContext, "b1");

    expect(result.tool).toBe("query_schedule");
    expect(result.missing).toEqual([]);
  });

  it("falls back to unknown on malformed JSON", async () => {
    mockCallWithFallback.mockResolvedValue({
      content: "not json {{{",
    } as never);

    const result = await routeMessage("gibberish", baseContext, "b1");

    expect(result.tool).toBe("unknown");
    expect(result.params).toEqual({});
    expect(result.missing).toBeUndefined();
  });
});
