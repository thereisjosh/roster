import { NextRequest, NextResponse } from "next/server";
import { eq, and, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { staff, business, communicationLog, telegramRegistration, availabilitySubmission, coverOffer, coverRequest } from "@/lib/db/schema";
import { HELP_TEXT, handleScheduleQuery, handleStatusQuery, handleCoverRequest } from "@/lib/chat/handlers";
import { routeMessage } from "@/lib/chat/router";
import { executeAction, resolveConversationState } from "@/lib/chat/executor";
import { inngest } from "@/lib/inngest/client";
import { isAlreadyProcessed } from "@/lib/messaging/idempotency";
import { getPendingState, clearState } from "@/lib/chat/conversation-state";
import { captureError } from "@/lib/sentry";
import { createLogger } from "@/lib/logging";

const logger = createLogger("telegram-webhook");

/**
 * Telegram Bot webhook receiver.
 *
 * Setup: Register this webhook URL with Telegram via:
 *   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=<DOMAIN>/api/webhook/telegram&secret_token=<SECRET>"
 *
 * Env vars:
 *   TELEGRAM_BOT_TOKEN — bot token from @BotFather
 *   TELEGRAM_WEBHOOK_SECRET — secret_token passed to setWebhook (used to verify requests)
 */

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: { id: number; first_name: string };
    chat: { id: number; type: string };
    text?: string;
    date: number;
  };
  callback_query?: {
    id: string;
    from: { id: number; first_name: string };
    message?: { chat: { id: number } };
    data?: string;
  };
}

export async function POST(request: NextRequest) {
  // Verify secret token
  const secret = request.headers.get("x-telegram-bot-api-secret-token");
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (expectedSecret && secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch (error) {
    captureError(error, { source: "telegram-webhook", phase: "parse" });
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  try {
  // Deduplicate retried webhooks
  const updateId = String(update.update_id);
  if (await isAlreadyProcessed(updateId, "telegram")) {
    return NextResponse.json({ ok: true });
  }

  const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
  const text = update.message?.text ?? update.callback_query?.data;

  if (!chatId) {
    return NextResponse.json({ ok: true });
  }

  const chatIdStr = String(chatId);

  // Handle /start command with payload
  if (update.message?.text?.startsWith("/start")) {
    const payload = update.message.text.split(" ")[1];

    if (payload?.startsWith("link_")) {
      // Link existing staff
      const staffId = payload.slice(5);
      await linkTelegramChat(staffId, chatIdStr);
      await sendTelegramMessage(chatIdStr, "Linked! You'll receive roster notifications here.");
      return NextResponse.json({ ok: true });
    }

    if (payload?.startsWith("join_")) {
      // Self-registration: look up business by invite code
      const inviteCode = payload.slice(5);
      const biz = await db.query.business.findFirst({
        where: eq(business.inviteCode, inviteCode),
      });
      if (!biz) {
        await sendTelegramMessage(chatIdStr, "Invalid invite code. Please check the link and try again.");
        return NextResponse.json({ ok: true });
      }

      // Clean up any stale registrations older than 1 hour
      await db.delete(telegramRegistration).where(
        lt(telegramRegistration.createdAt, new Date(Date.now() - 60 * 60 * 1000))
      );

      // Start registration conversation
      await db
        .insert(telegramRegistration)
        .values({
          chatId: chatIdStr,
          businessId: biz.id,
          step: "awaiting_name",
        })
        .onConflictDoUpdate({
          target: telegramRegistration.chatId,
          set: {
            businessId: biz.id,
            step: "awaiting_name",
            name: null,
            createdAt: new Date(),
          },
        });

      await sendTelegramMessage(
        chatIdStr,
        `Welcome to ${biz.name}! Let's get you registered.\n\nWhat's your name?`
      );
      return NextResponse.json({ ok: true });
    }

    if (!payload) {
      await sendTelegramMessage(
        chatIdStr,
        "Welcome to Roster Bot!\n\nTo link your account, use the link your manager shared with you.\nTo join a business, ask your manager for the invite link."
      );
      return NextResponse.json({ ok: true });
    }

    // Legacy: bare staffId (backwards compat)
    await linkTelegramChat(payload, chatIdStr);
    await sendTelegramMessage(chatIdStr, "Linked! You'll receive roster notifications here.");
    return NextResponse.json({ ok: true });
  }

  // Handle /help command
  if (update.message?.text?.startsWith("/help")) {
    await sendTelegramMessage(chatIdStr, HELP_TEXT);
    return NextResponse.json({ ok: true });
  }

  // Answer callback queries (inline keyboard presses) — prefix-dispatch
  if (update.callback_query) {
    await answerCallbackQuery(update.callback_query.id);

    const cbData = update.callback_query.data ?? "";
    const staffRow = await db.query.staff.findFirst({
      where: eq(staff.telegramChatId, chatIdStr),
    });

    if (staffRow) {
      if (cbData.startsWith("cover_accept_") || cbData.startsWith("cover_decline_")) {
        const accepted = cbData.startsWith("cover_accept_");
        const coverRequestId = cbData.replace(/^cover_(accept|decline)_/, "");
        await inngest.send({
          name: "cover/offer.responded",
          data: { coverRequestId, candidateStaffId: staffRow.id, accepted },
        });
        await sendTelegramMessage(chatIdStr, accepted ? "Thanks! I've noted you're available." : "No worries, I'll ask someone else.");
      } else if (cbData.startsWith("cover_date_")) {
        const date = cbData.replace("cover_date_", "");
        const result = await handleCoverRequest(staffRow.id, staffRow.businessId, date);
        if (result.coverRequestId) {
          await sendTelegramMessage(chatIdStr, result.reply, {
            inline_keyboard: [[{ text: "Cancel Request", callback_data: `cover_cancel_${result.coverRequestId}` }]],
          });
        } else {
          await sendTelegramMessage(chatIdStr, result.reply);
        }
      } else if (cbData.startsWith("cover_cancel_")) {
        const coverRequestId = cbData.replace("cover_cancel_", "");
        await db
          .update(coverRequest)
          .set({ status: "cancelled" })
          .where(eq(coverRequest.id, coverRequestId));
        await sendTelegramMessage(chatIdStr, "Cover request cancelled.");
      } else if (cbData.startsWith("avail_confirm_")) {
        const submissionId = cbData.replace("avail_confirm_", "");
        await db
          .update(availabilitySubmission)
          .set({ status: "confirmed" })
          .where(eq(availabilitySubmission.id, submissionId));
        await sendTelegramMessage(chatIdStr, "Availability confirmed!");
      } else if (cbData === "avail_redo") {
        await sendTelegramMessage(chatIdStr, "OK, send me your updated availability.");
      } else if (cbData.startsWith("action_")) {
        const action = cbData.replace("action_", "");
        if (action === "schedule") {
          const reply = await handleScheduleQuery(staffRow.id, staffRow.businessId);
          await sendTelegramMessage(chatIdStr, reply);
        } else if (action === "status") {
          const reply = await handleStatusQuery(staffRow.id);
          await sendTelegramMessage(chatIdStr, reply);
        } else if (action === "help") {
          await sendTelegramMessage(chatIdStr, HELP_TEXT);
        }
      }
    }
    return NextResponse.json({ ok: true });
  }

  // Check for in-progress registration
  const reg = await db.query.telegramRegistration.findFirst({
    where: eq(telegramRegistration.chatId, chatIdStr),
  });

  if (reg) {
    return await handleRegistration(reg, chatIdStr, text ?? "");
  }

  // Try to find staff by telegram chat ID
  const staffRow = await db.query.staff.findFirst({
    where: eq(staff.telegramChatId, chatIdStr),
  });

  if (!staffRow) {
    await sendTelegramMessage(chatIdStr, "I don't recognise this account. Use the link your manager shared to get started.");
    return NextResponse.json({ ok: true });
  }

  // Log inbound message
  await db.insert(communicationLog).values({
    businessId: staffRow.businessId,
    staffId: staffRow.id,
    direction: "inbound",
    channel: "telegram",
    body: text ?? "",
    sentAt: new Date(),
  });

  // Check for pending conversation state (multi-turn parameter collection)
  const pendingState = await getPendingState(staffRow.id);
  if (pendingState) {
    const resolved = await resolveConversationState(
      pendingState,
      text ?? "",
      staffRow.id,
      staffRow.businessId,
      { pendingOffer: null, latestSubmission: null },
    );
    if (resolved) {
      await clearState(staffRow.id);
      await sendTelegramMessage(chatIdStr, resolved.reply, resolved.replyMarkup);
      return NextResponse.json({ ok: true });
    }
    // Couldn't parse reply — clear state and fall through to normal routing
    await clearState(staffRow.id);
  }

  // Build routing context
  const pendingOffer = await db.query.coverOffer.findFirst({
    where: and(
      eq(coverOffer.candidateStaffId, staffRow.id),
      eq(coverOffer.status, "pending"),
    ),
  });
  const latestSubmission = await db.query.availabilitySubmission.findFirst({
    where: eq(availabilitySubmission.staffId, staffRow.id),
    orderBy: (t, { desc: d }) => [d(t.submittedAt)],
  });

  const { tool, params, missing } = await routeMessage(text ?? "", {
    today: new Date().toISOString().slice(0, 10),
    hasPendingOffer: !!pendingOffer,
    hasUnconfirmedSubmission: !!(latestSubmission && latestSubmission.status === "submitted"),
  }, staffRow.businessId);

  const result = await executeAction(tool, params, missing, staffRow.id, staffRow.businessId, text ?? "", {
    pendingOffer: pendingOffer ? { coverRequestId: pendingOffer.coverRequestId, candidateStaffId: staffRow.id } : null,
    latestSubmission: latestSubmission ? { id: latestSubmission.id, status: latestSubmission.status } : null,
  });

  await sendTelegramMessage(chatIdStr, result.reply, result.replyMarkup);
  return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error({ err: error }, "telegram webhook error");
    captureError(error, { source: "telegram-webhook" });
    return NextResponse.json({ ok: true }); // Return 200 to prevent Telegram retries
  }
}

async function handleRegistration(
  reg: { chatId: string; businessId: string; step: string; name: string | null },
  chatId: string,
  text: string,
) {
  if (reg.step === "awaiting_name") {
    const name = text.trim();
    if (!name || name.length < 1) {
      await sendTelegramMessage(chatId, "Please enter your name.");
      return NextResponse.json({ ok: true });
    }
    await db
      .update(telegramRegistration)
      .set({ step: "awaiting_phone", name })
      .where(eq(telegramRegistration.chatId, chatId));
    await sendTelegramMessage(chatId, `Thanks, ${name}! What's your phone number?`);
    return NextResponse.json({ ok: true });
  }

  if (reg.step === "awaiting_phone") {
    const phone = text.trim();
    if (!phone || phone.length < 4) {
      await sendTelegramMessage(chatId, "Please enter a valid phone number.");
      return NextResponse.json({ ok: true });
    }

    // Create staff + clean up registration + log (atomic)
    const { newStaff, bizName } = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(staff)
        .values({
          businessId: reg.businessId,
          name: reg.name!,
          phone,
          telegramChatId: chatId,
          isActive: true,
        })
        .returning();

      await tx.delete(telegramRegistration).where(eq(telegramRegistration.chatId, chatId));

      await tx.insert(communicationLog).values({
        businessId: reg.businessId,
        staffId: created.id,
        direction: "outbound",
        channel: "telegram",
        body: "Staff self-registered via Telegram",
        sentAt: new Date(),
      });

      const biz = await tx.query.business.findFirst({
        where: eq(business.id, reg.businessId),
      });

      return { newStaff: created, bizName: biz?.name ?? "the business" };
    });

    await sendTelegramMessage(
      chatId,
      `You're registered at ${bizName}! You'll receive roster notifications here.`
    );

    return NextResponse.json({ ok: true });
  }

  // Unknown step — reset
  await db.delete(telegramRegistration).where(eq(telegramRegistration.chatId, chatId));
  await sendTelegramMessage(chatId, "Something went wrong. Please try again with your invite link.");
  return NextResponse.json({ ok: true });
}

async function linkTelegramChat(staffId: string, chatId: string) {
  await db.update(staff).set({ telegramChatId: chatId }).where(eq(staff.id, staffId));
}

async function sendTelegramMessage(chatId: string, text: string, reply_markup?: Record<string, any>) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const payload: Record<string, any> = { chat_id: chatId, text };
  if (reply_markup) payload.reply_markup = reply_markup;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function answerCallbackQuery(callbackQueryId: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
  });
}
