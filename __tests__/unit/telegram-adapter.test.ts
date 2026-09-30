import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SendMessageRequest, StaffContact } from "@/lib/messaging/types";
import { TelegramAdapter } from "@/lib/messaging/adapters/telegram";

const MOCK_TOKEN = "123456:ABC-DEF";

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

describe("TelegramAdapter.send", () => {
  let adapter: TelegramAdapter;

  beforeEach(() => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", MOCK_TOKEN);
    adapter = new TelegramAdapter();
    vi.restoreAllMocks();
  });

  it("returns error when no telegramChatId on contact", async () => {
    const result = await adapter.send(makeRequest(), makeContact());

    expect(result.success).toBe(false);
    expect(result.error).toBe("No Telegram chat ID");
    expect(result.channel).toBe("telegram");
  });

  it("calls correct Telegram API URL with bot token", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, result: { message_id: 42 } }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await adapter.send(makeRequest(), makeContact({ telegramChatId: "999" }));

    expect(mockFetch).toHaveBeenCalledWith(
      `https://api.telegram.org/bot${MOCK_TOKEN}/sendMessage`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("sends inline keyboard when inlineKeyboard is provided", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, result: { message_id: 43 } }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const keyboard = [[{ text: "Yes", callback_data: "yes" }]];
    await adapter.send(
      makeRequest({ inlineKeyboard: keyboard }),
      makeContact({ telegramChatId: "999" }),
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.reply_markup).toEqual({ inline_keyboard: keyboard });
  });

  it("returns success with message ID on 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, result: { message_id: 44 } }),
    }));

    const result = await adapter.send(
      makeRequest(),
      makeContact({ telegramChatId: "999" }),
    );

    expect(result.success).toBe(true);
    expect(result.messageId).toBe("44");
    expect(result.cost).toBe(0);
    expect(result.channel).toBe("telegram");
  });

  it("returns error on API failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: false, description: "Chat not found" }),
    }));

    const result = await adapter.send(
      makeRequest(),
      makeContact({ telegramChatId: "999" }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Chat not found");
  });
});
