CREATE TABLE "conversation_state" (
	"staff_id" uuid PRIMARY KEY NOT NULL,
	"pending_tool" text NOT NULL,
	"pending_params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pending_prompt" text NOT NULL,
	"channel" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_page" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"page_type" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processed_webhook_message" (
	"id" text PRIMARY KEY NOT NULL,
	"channel" text NOT NULL,
	"processed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_composition_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"shift_type" text,
	"tag" text NOT NULL,
	"minimum_count" integer DEFAULT 1 NOT NULL,
	"min_proficiency" real DEFAULT 0,
	"required" boolean DEFAULT false NOT NULL,
	"condition" jsonb,
	"source_utterance" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_relationship" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"staff_id_1" uuid NOT NULL,
	"staff_id_2" uuid,
	"semantics" text NOT NULL,
	"label" text NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"rejected_at" timestamp,
	"last_reinforced_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_skill" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"tag" text NOT NULL,
	"proficiency" real DEFAULT 1,
	"notes" text,
	"source" text NOT NULL,
	"source_utterance" text,
	"confirmed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cover_request" ADD COLUMN "request_type" text DEFAULT 'cover' NOT NULL;--> statement-breakpoint
ALTER TABLE "preference_rule" ADD COLUMN "rejected_at" timestamp;--> statement-breakpoint
ALTER TABLE "preference_rule" ADD COLUMN "last_reinforced_at" timestamp;--> statement-breakpoint
ALTER TABLE "schedule_variation" ADD COLUMN "approval_feedback" jsonb;--> statement-breakpoint
ALTER TABLE "conversation_state" ADD CONSTRAINT "conversation_state_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_page" ADD CONSTRAINT "knowledge_page_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_composition_rule" ADD CONSTRAINT "shift_composition_rule_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_relationship" ADD CONSTRAINT "staff_relationship_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_relationship" ADD CONSTRAINT "staff_relationship_staff_id_1_staff_id_fk" FOREIGN KEY ("staff_id_1") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_relationship" ADD CONSTRAINT "staff_relationship_staff_id_2_staff_id_fk" FOREIGN KEY ("staff_id_2") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_skill" ADD CONSTRAINT "staff_skill_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_skill" ADD CONSTRAINT "staff_skill_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_page_business_slug_idx" ON "knowledge_page" USING btree ("business_id","slug");--> statement-breakpoint
CREATE INDEX "knowledge_page_business_type_idx" ON "knowledge_page" USING btree ("business_id","page_type");--> statement-breakpoint
CREATE INDEX "knowledge_page_metadata_idx" ON "knowledge_page" USING btree ("metadata");--> statement-breakpoint
CREATE INDEX "shift_comp_business_idx" ON "shift_composition_rule" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "staff_rel_business_idx" ON "staff_relationship" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "staff_rel_staff1_idx" ON "staff_relationship" USING btree ("staff_id_1");--> statement-breakpoint
CREATE INDEX "staff_rel_staff2_idx" ON "staff_relationship" USING btree ("staff_id_2");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_rel_pair_semantics_idx" ON "staff_relationship" USING btree ("business_id","staff_id_1","staff_id_2","semantics","label");--> statement-breakpoint
CREATE INDEX "staff_skill_business_idx" ON "staff_skill" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "staff_skill_staff_idx" ON "staff_skill" USING btree ("staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_skill_unique_idx" ON "staff_skill" USING btree ("staff_id","tag");