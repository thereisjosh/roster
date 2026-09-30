ALTER TYPE "public"."message_channel" ADD VALUE 'telegram';--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "telegram_chat_id" text;