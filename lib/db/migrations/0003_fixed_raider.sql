CREATE TYPE "public"."cover_offer_status" AS ENUM('pending', 'accepted', 'declined', 'expired');--> statement-breakpoint
CREATE TABLE "cover_offer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cover_request_id" uuid NOT NULL,
	"candidate_staff_id" uuid NOT NULL,
	"status" "cover_offer_status" DEFAULT 'pending' NOT NULL,
	"offered_at" timestamp DEFAULT now() NOT NULL,
	"responded_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "cover_offer" ADD CONSTRAINT "cover_offer_cover_request_id_cover_request_id_fk" FOREIGN KEY ("cover_request_id") REFERENCES "public"."cover_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cover_offer" ADD CONSTRAINT "cover_offer_candidate_staff_id_staff_id_fk" FOREIGN KEY ("candidate_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cover_offer_request_idx" ON "cover_offer" USING btree ("cover_request_id");--> statement-breakpoint
CREATE INDEX "cover_offer_candidate_idx" ON "cover_offer" USING btree ("candidate_staff_id","status");