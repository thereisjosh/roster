CREATE TABLE IF NOT EXISTS "staff_skill" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "business_id" uuid NOT NULL REFERENCES "business"("id") ON DELETE CASCADE,
  "staff_id" uuid NOT NULL REFERENCES "staff"("id") ON DELETE CASCADE,
  "tag" text NOT NULL,
  "proficiency" real DEFAULT 1.0,
  "notes" text,
  "source" text NOT NULL,
  "source_utterance" text,
  "confirmed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "staff_skill_business_idx" ON "staff_skill" ("business_id");
CREATE INDEX IF NOT EXISTS "staff_skill_staff_idx" ON "staff_skill" ("staff_id");
CREATE UNIQUE INDEX IF NOT EXISTS "staff_skill_unique_idx" ON "staff_skill" ("staff_id", "tag");

CREATE TABLE IF NOT EXISTS "shift_composition_rule" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "business_id" uuid NOT NULL REFERENCES "business"("id") ON DELETE CASCADE,
  "shift_type" text,
  "tag" text NOT NULL,
  "minimum_count" integer NOT NULL DEFAULT 1,
  "min_proficiency" real DEFAULT 0.0,
  "required" boolean NOT NULL DEFAULT false,
  "source_utterance" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "shift_comp_business_idx" ON "shift_composition_rule" ("business_id");
