import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChannelRouterDeps } from "@/lib/messaging/channel-router";
import type { StaffContact, SendMessageRequest, ConversationWindow } from "@/lib/messaging/types";

// Mock all adapters so ChannelRouter constructor doesn't need real env vars
vi.mock("@/lib/messaging/adapters/whatsapp", () => ({
  WhatsAppAdapter: vi.fn().mockImplementation(() => ({ send: vi.fn() })),
}));
vi.mock("@/lib/messaging/adapters/email", () => ({
  EmailAdapter: vi.fn().mockImplementation(() => ({ send: vi.fn() })),
}));
vi.mock("@/lib/messaging/adapters/sms", () => ({
  SmsAdapter: vi.fn().mockImplementation(() => ({ send: vi.fn() })),
}));
vi.mock("@/lib/messaging/adapters/telegram", () => ({
  TelegramAdapter: vi.fn().mockImplementation(() => ({ send: vi.fn() })),
}));

import { ChannelRouter } from "@/lib/messaging/channel-router";

function makeContact(overrides: Partial<StaffContact> = {}): StaffContact {
  return {
    staffId: "s1",
    businessId: "b1",
    hasWhatsapp: false,
    ...overrides,
  };
}

function makeRequest(overrides: Partial<SendMessageRequest> = {}): SendMessageRequest {
  return {
    staffId: "s1",
    businessId: "b1",
    content: "Hello",
    urgency: "non_urgent",
    ...overrides,
  };
}

function makeDeps(windowOverride?: ConversationWindow | null): ChannelRouterDeps {
  return {
    getConversationWindow: vi.fn().mockResolvedValue(windowOverride ?? null),
    getStaffContact: vi.fn(),
    logMessageSent: vi.fn(),
  };
}

describe("ChannelRouter.selectChannel", () => {
  it("returns 'telegram' when staff has telegramChatId", async () => {
    const deps = makeDeps();
    const router = new ChannelRouter(deps);
    const contact = makeContact({ telegramChatId: "12345" });

    const channel = await router.selectChannel(makeRequest(), contact);
    expect(channel).toBe("telegram");
  });

  it("returns 'whatsapp_reply' when no Telegram but active conversation window", async () => {
    const window: ConversationWindow = {
      staffId: "s1",
      channel: "whatsapp",
      windowOpensAt: new Date(Date.now() - 3600_000),
      windowExpiresAt: new Date(Date.now() + 3600_000),
    };
    const deps = makeDeps(window);
    const router = new ChannelRouter(deps);
    const contact = makeContact({ hasWhatsapp: true, whatsappPhone: "+1234567890" });

    const channel = await router.selectChannel(makeRequest(), contact);
    expect(channel).toBe("whatsapp_reply");
  });

  it("returns 'email' for non-urgent when no Telegram or WhatsApp window", async () => {
    const deps = makeDeps();
    const router = new ChannelRouter(deps);
    const contact = makeContact({ email: "staff@example.com" });

    const channel = await router.selectChannel(makeRequest({ urgency: "non_urgent" }), contact);
    expect(channel).toBe("email");
  });

  it("returns 'whatsapp_template' for time-sensitive with WhatsApp but no window", async () => {
    const deps = makeDeps();
    const router = new ChannelRouter(deps);
    const contact = makeContact({ hasWhatsapp: true, whatsappPhone: "+1234567890" });

    const channel = await router.selectChannel(makeRequest({ urgency: "time_sensitive" }), contact);
    expect(channel).toBe("whatsapp_template");
  });

  it("returns 'sms' as critical fallback when only phone available", async () => {
    const deps = makeDeps();
    const router = new ChannelRouter(deps);
    const contact = makeContact({ smsPhone: "+1234567890" });

    const channel = await router.selectChannel(makeRequest({ urgency: "critical" }), contact);
    expect(channel).toBe("sms");
  });

  it("telegram takes priority over active WhatsApp window", async () => {
    const window: ConversationWindow = {
      staffId: "s1",
      channel: "whatsapp",
      windowOpensAt: new Date(Date.now() - 3600_000),
      windowExpiresAt: new Date(Date.now() + 3600_000),
    };
    const deps = makeDeps(window);
    const router = new ChannelRouter(deps);
    const contact = makeContact({
      telegramChatId: "12345",
      hasWhatsapp: true,
      whatsappPhone: "+1234567890",
    });

    const channel = await router.selectChannel(makeRequest(), contact);
    expect(channel).toBe("telegram");
  });
});
