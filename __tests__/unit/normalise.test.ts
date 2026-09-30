import { describe, it, expect } from "vitest";
import { normalise } from "@/lib/chat/normalise";

describe("normalise", () => {
  it("expands shorthand and strips particles", () => {
    expect(normalise("tmr cant come lah")).toBe("tomorrow cannot come");
  });

  it("strips particles and keeps mc as-is", () => {
    expect(normalise("mc lah today")).toBe("mc today");
  });

  it("expands boleh", () => {
    expect(normalise("boleh")).toBe("can");
  });

  it("leaves unknown words unchanged", () => {
    expect(normalise("i free mon wed fri")).toBe("i free mon wed fri");
  });

  it("expands cannt and tdy", () => {
    expect(normalise("cannt come in tdy")).toBe("cannot come in today");
  });

  it("expands avail", () => {
    expect(normalise("avail whole week")).toBe("available whole week");
  });

  it("handles empty string", () => {
    expect(normalise("")).toBe("");
  });

  it("handles whitespace-only input", () => {
    expect(normalise("   ")).toBe("");
  });

  it("collapses multiple spaces", () => {
    expect(normalise("tmr   cant   come")).toBe("tomorrow cannot come");
  });

  it("preserves particles when they would leave only one word", () => {
    expect(normalise("cannot lah")).toBe("cannot lah");
  });
});
