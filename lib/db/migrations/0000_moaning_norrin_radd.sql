CREATE TYPE "public"."availability_status" AS ENUM('pending', 'submitted', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."cover_request_status" AS ENUM('open', 'filled', 'escalated');--> statement-breakpoint
CREATE TYPE "public"."employment_type" AS ENUM('full_time', 'part_time', 'casual');--> statement-breakpoint
CREATE TYPE "public"."message_channel" AS ENUM('whatsapp_reply', 'whatsapp_template', 'email', 'sms');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."rule_source" AS ENUM('manager_explicit', 'learned_from_edit', 'staff_request');--> statement-breakpoint
CREATE TYPE "public"."rule_type" AS ENUM('soft', 'hard', 'temporary');--> statement-breakpoint
CREATE TYPE "public"."schedule_run_status" AS ENUM('generating', 'pending_review', 'approved', 'finalised', 'escalated');--> statement-breakpoint
CREATE TYPE "public"."subscription_tier" AS ENUM('trial', 'starter', 'pro', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'manager', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."variation_type" AS ENUM('cost_optimised', 'fairness_optimised', 'balanced');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "availability_submission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"week_start" timestamp NOT NULL,
	"status" "availability_status" DEFAULT 'pending' NOT NULL,
	"slots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submitted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Singapore' NOT NULL,
	"subscription_tier" "subscription_tier" DEFAULT 'trial' NOT NULL,
	"config" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "communication_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"staff_id" uuid,
	"direction" "message_direction" NOT NULL,
	"channel" "message_channel" NOT NULL,
	"body" text NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"delivered_at" timestamp,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_window" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"window_opens_at" timestamp NOT NULL,
	"window_expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cover_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_run_id" uuid NOT NULL,
	"shift_id" text NOT NULL,
	"requesting_staff_id" uuid NOT NULL,
	"status" "cover_request_status" DEFAULT 'open' NOT NULL,
	"candidates" jsonb DEFAULT '[]'::jsonb,
	"filled_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_call_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" text NOT NULL,
	"task_type" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cost_usd" real NOT NULL,
	"latency_ms" integer NOT NULL,
	"success" boolean NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manager_edit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"variation_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"original_shift" text NOT NULL,
	"new_shift" text NOT NULL,
	"edit_reason" text,
	"extracted_rules" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "preference_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"rule_text" text NOT NULL,
	"rule_type" "rule_type" DEFAULT 'soft' NOT NULL,
	"source" "rule_source" DEFAULT 'manager_explicit' NOT NULL,
	"confidence" real DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"week_start" timestamp NOT NULL,
	"status" "schedule_run_status" DEFAULT 'generating' NOT NULL,
	"prompt_version" text,
	"model_version" text,
	"cost_usd" real,
	"generation_snapshot" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_variation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"variation_type" "variation_type" NOT NULL,
	"assignments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"coverage_warnings" text,
	"total_cost" real,
	"approved_at" timestamp,
	"approved_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"employment_type" "employment_type" DEFAULT 'part_time' NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pay_structure" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"business_id" uuid,
	"role" "user_role" DEFAULT 'owner' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_submission" ADD CONSTRAINT "availability_submission_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_log" ADD CONSTRAINT "communication_log_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_log" ADD CONSTRAINT "communication_log_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_window" ADD CONSTRAINT "conversation_window_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cover_request" ADD CONSTRAINT "cover_request_schedule_run_id_schedule_run_id_fk" FOREIGN KEY ("schedule_run_id") REFERENCES "public"."schedule_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cover_request" ADD CONSTRAINT "cover_request_requesting_staff_id_staff_id_fk" FOREIGN KEY ("requesting_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cover_request" ADD CONSTRAINT "cover_request_filled_by_staff_id_fk" FOREIGN KEY ("filled_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_edit" ADD CONSTRAINT "manager_edit_run_id_schedule_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."schedule_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_edit" ADD CONSTRAINT "manager_edit_variation_id_schedule_variation_id_fk" FOREIGN KEY ("variation_id") REFERENCES "public"."schedule_variation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_edit" ADD CONSTRAINT "manager_edit_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preference_rule" ADD CONSTRAINT "preference_rule_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_run" ADD CONSTRAINT "schedule_run_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_variation" ADD CONSTRAINT "schedule_variation_run_id_schedule_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."schedule_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_variation" ADD CONSTRAINT "schedule_variation_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "availability_staff_week_idx" ON "availability_submission" USING btree ("staff_id","week_start");--> statement-breakpoint
CREATE INDEX "communication_log_business_idx" ON "communication_log" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "communication_log_staff_idx" ON "communication_log" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "conversation_window_staff_idx" ON "conversation_window" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "cover_request_run_idx" ON "cover_request" USING btree ("schedule_run_id");--> statement-breakpoint
CREATE INDEX "llm_call_log_business_idx" ON "llm_call_log" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "manager_edit_run_idx" ON "manager_edit" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "preference_rule_business_idx" ON "preference_rule" USING btree ("business_id","active");--> statement-breakpoint
CREATE INDEX "schedule_run_business_idx" ON "schedule_run" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "schedule_variation_run_idx" ON "schedule_variation" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "staff_business_id_idx" ON "staff" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "staff_active_idx" ON "staff" USING btree ("business_id","is_active");