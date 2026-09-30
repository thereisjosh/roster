import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { staff, business, communicationLog, conversationWindow, availabilitySubmission, coverOffer } from "@/lib/db/schema";
import crypto from "crypto";
import { parseAvailability } from "@/lib/availability/nl-parser";
import { upsertAvailability } from "@/lib/availability/submit-from-chat";
import { HELP_TEXT, handleScheduleQuery, handleStatusQuery, handleCoverRequest } from "@/lib/chat/handlers";
import { routeMessage } from "@/lib/chat/router";
import { executeAction, resolveConversationState } from "@/lib/chat/executor";
import { inngest } from "@/lib/inngest/client";
import { isAlreadyProcessed } from "@/lib/messaging/idempotency";
import { getPendingState, clearState } from "@/lib/chat/conversation-state";
import { captureError } from "@/lib/sentry";
import { createLogger } from "@/lib/logging";

const logger = createLogger("whatsapp-webhook");

/**
 * WhatsApp Cloud API webhook receiver.
 *
 * Env vars:
 *   WHATSAPP_VERIFY_TOKEN — token for GET verification challenge
 *   WHATSAPP_APP_SECRET — Meta app secret for signature verification
 */

// GET: Meta webhook verification challenge
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

// POST: Inbound messages
export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  // Verify signature
  const signature = request.headers.get("x-hub-signature-256");
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (appSecret && signature) {
    const expectedSig = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
    if (signature !== expectedSig) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  let body: WhatsAppWebhookBody;
  try {
    body = JSON.parse(rawBody) as WhatsAppWebhookBody;
  } catch (error) {
    captureError(error, { source: "whatsapp-webhook", phase: "parse" });
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  try {
  // Process each entry
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      const value = change.value;

      for (const message of value.messages ?? []) {
        if (await isAlreadyProcessed(message.id, "whatsapp")) continue;

        const phone = message.from;
        const text = message.text?.body ?? "";

        // Find staff by phone
        const staffRow = await db.query.staff.findFirst({
          where: eq(staff.phone, phone),
        });

        if (!staffRow) continue;

        // Update conversation window (24hr free reply window)
        const now = new Date();
        const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        await db
          .insert(conversationWindow)
          .values({
            staffId: staffRow.id,
            channel: "whatsapp",
            windowOpensAt: now,
            windowExpiresAt: expires,
          });

        // Log inbound message
        await db.insert(communicationLog).values({
          businessId: staffRow.businessId,
          staffId: staffRow.id,
          direction: "inbound",
          channel: "whatsapp_reply",
          body: text,
          sentAt: now,
        });

        // Check for pending conversation state (multi-turn parameter collection)
        const pendingState = await getPendingState(staffRow.id);
        if (pendingState) {
          const resolved = await resolveConversationState(
            pendingState,
            text,
            staffRow.id,
            staffRow.businessId,
            { pendingOffer: null, latestSubmission: null },
          );
          if (resolved) {
            await clearState(staffRow.id);
            await sendWhatsAppMessage(value.metadata.phone_number_id, phone, resolved.reply);
            continue;
          }
          await clearState(staffRow.id);
        }

        // Handle help command before routing
        if (text.trim().toLowerCase() === "/help" || text.trim().toLowerCase() === "help") {
          await sendWhatsAppMessage(value.metadata.phone_number_id, phone, HELP_TEXT);
          continue;
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

        const { tool, params } = await routeMessage(text, {
          today: new Date().toISOString().slice(0, 10),
          hasPendingOffer: !!pendingOffer,
          hasUnconfirmedSubmission: !!(latestSubmission && latestSubmission.status === "submitted"),
        }, staffRow.businessId);

        const phoneNumberId = value.metadata.phone_number_id;

        switch (tool) {
          case "update_availability": {
            const biz = await db.query.business.findFirst({
              where: eq(business.id, staffRow.businessId),
            });
            const weekStartDay = biz?.config?.weekStartDay ?? 1;

            const { slots, weekStart } = await parseAvailability(text, staffRow.businessId, weekStartDay);

            if (slots.length === 0) {
              await sendWhatsAppMessage(
                phoneNumberId,
                phone,
                "I couldn't understand your availability. Try something like:\n• \"Monday to Friday 9am-5pm\"\n• \"Saturday off\"\n• \"Available all week\"",
              );
              continue;
            }

            await upsertAvailability(staffRow.id, weekStart, slots);

            const summary = slots
              .map((s) => {
                const d = new Date(s.day);
                const dayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
                if (s.preference === "unavailable") return `${dayName}: OFF`;
                return `${dayName}: ${s.startTime}-${s.endTime} ✓`;
              })
              .join("\n");

            await sendWhatsAppMessage(
              phoneNumberId,
              phone,
              `Got it! Here's what I recorded:\n${summary}\n\nSend corrections anytime.`,
            );
            break;
          }

          case "query_schedule": {
            const reply = await handleScheduleQuery(staffRow.id, staffRow.businessId);
            await sendWhatsAppMessage(phoneNumberId, phone, reply);
            break;
          }

          case "check_status": {
            const reply = await handleStatusQuery(staffRow.id);
            await sendWhatsAppMessage(phoneNumberId, phone, reply);
            break;
          }

          case "respond_to_offer": {
            if (pendingOffer) {
              const accepted = params.accepted === true;
              await inngest.send({
                name: "cover/offer.responded",
                data: {
                  coverRequestId: pendingOffer.coverRequestId,
                  candidateStaffId: staffRow.id,
                  accepted,
                },
              });
              await sendWhatsAppMessage(phoneNumberId, phone, accepted ? "Thanks! I've noted you're available." : "No worries, I'll ask someone else.");
            } else {
              await sendWhatsAppMessage(phoneNumberId, phone, "Nothing to respond to right now.");
            }
            break;
          }

          case "confirm_availability": {
            if (latestSubmission && latestSubmission.status === "submitted") {
              await db
                .update(availabilitySubmission)
                .set({ status: "confirmed" })
                .where(eq(availabilitySubmission.id, latestSubmission.id));
              await sendWhatsAppMessage(phoneNumberId, phone, "Availability confirmed!");
            } else {
              await sendWhatsAppMessage(phoneNumberId, phone, "Nothing to confirm right now.");
            }
            break;
          }

          case "request_cover": {
            const result = await handleCoverRequest(staffRow.id, staffRow.businessId, params.date ?? null);
            await sendWhatsAppMessage(phoneNumberId, phone, result.reply);
            break;
          }

          default: {
            await sendWhatsAppMessage(
              phoneNumberId,
              phone,
              "I didn't understand that. Try telling me your availability, asking about your schedule, or send \"help\" to see what I can do.",
            );
            break;
          }
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error({ err: error }, "whatsapp webhook error");
    captureError(error, { source: "whatsapp-webhook" });
    return NextResponse.json({ ok: true });
  }
}

async function sendWhatsAppMessage(phoneNumberId: string, to: string, text: string) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) return;
  await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
  });
}

// WhatsApp webhook payload types
interface WhatsAppWebhookBody {
  object: string;
  entry?: Array<{
    id: string;
    changes?: Array<{
      field: string;
      value: {
        messaging_product: string;
        metadata: { display_phone_number: string; phone_number_id: string };
        messages?: Array<{
          from: string;
          id: string;
          timestamp: string;
          type: string;
          text?: { body: string };
        }>;
      };
    }>;
  }>;
}
