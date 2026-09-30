CREATE TABLE "telegram_registration" (
	"chat_id" text PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"step" text NOT NULL,
	"name" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business" ADD COLUMN "invite_code" text;--> statement-breakpoint
ALTER TABLE "telegram_registration" ADD CONSTRAINT "telegram_registration_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business" ADD CONSTRAINT "business_invite_code_unique" UNIQUE("invite_code");