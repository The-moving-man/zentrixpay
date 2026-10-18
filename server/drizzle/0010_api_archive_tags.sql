ALTER TABLE "apis" ADD COLUMN IF NOT EXISTS "archived_at" timestamp;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_apis_tags" ON "apis" USING gin ("tags");
