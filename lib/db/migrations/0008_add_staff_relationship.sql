-- Staff relationship table + lastReinforcedAt on preference_rule

DO $$ BEGIN
  CREATE TYPE "relationship_type" AS ENUM ('friction', 'affinity', 'requires_senior', 'mentorship');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "staff_relationship" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "business_id" uuid NOT NULL REFERENCES "business"("id") ON DELETE CASCADE,
  "staff_id_1" uuid NOT NULL REFERENCES "staff"("id") ON DELETE CASCADE,
  "staff_id_2" uuid REFERENCES "staff"("id") ON DELETE CASCADE,
  "type" "relationship_type" NOT NULL,
  "weight" real NOT NULL DEFAULT 1.0,
  "confirmed" boolean NOT NULL DEFAULT false,
  "evidence" jsonb DEFAULT '[]'::jsonb,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "rejected_at" timestamp,
  "last_reinforced_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "staff_rel_business_idx" ON "staff_relationship" ("business_id");
CREATE INDEX IF NOT EXISTS "staff_rel_staff1_idx" ON "staff_relationship" ("staff_id_1");
CREATE INDEX IF NOT EXISTS "staff_rel_staff2_idx" ON "staff_relationship" ("staff_id_2");
CREATE UNIQUE INDEX IF NOT EXISTS "staff_rel_pair_type_idx" ON "staff_relationship" ("business_id", "staff_id_1", "staff_id_2", "type");

-- Add lastReinforcedAt to preference_rule
ALTER TABLE "preference_rule" ADD COLUMN IF NOT EXISTS "last_reinforced_at" timestamp;
