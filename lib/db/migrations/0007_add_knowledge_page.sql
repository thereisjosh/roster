CREATE TABLE IF NOT EXISTS "knowledge_page" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "business_id" uuid NOT NULL REFERENCES "business"("id") ON DELETE CASCADE,
  "slug" text NOT NULL,
  "page_type" text NOT NULL,
  "title" text NOT NULL,
  "content" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_page_business_slug_idx" ON "knowledge_page" ("business_id", "slug");
CREATE INDEX IF NOT EXISTS "knowledge_page_business_type_idx" ON "knowledge_page" ("business_id", "page_type");
CREATE INDEX IF NOT EXISTS "knowledge_page_metadata_idx" ON "knowledge_page" USING GIN ("metadata");
