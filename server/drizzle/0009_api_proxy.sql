CREATE TABLE IF NOT EXISTS "apis" (
	"id" text PRIMARY KEY NOT NULL,
	"publisher_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"upstream_url" text NOT NULL,
	"price" text NOT NULL,
	"wallet_address" text NOT NULL,
	"allowed_methods" jsonb DEFAULT '["GET"]'::jsonb NOT NULL,
	"upstream_header_name" text,
	"upstream_header_value_enc" text,
	"timeout_ms" integer,
	"ownership_token" text NOT NULL,
	"ownership_verified_at" timestamp,
	"listed" boolean DEFAULT false NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "apis_publisher_id_publishers_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."publishers"("id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"api_id" text NOT NULL,
	"payer_address" text NOT NULL,
	"amount" text NOT NULL,
	"charged" boolean NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"response_status" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "api_calls_api_id_apis_id_fk" FOREIGN KEY ("api_id") REFERENCES "public"."apis"("id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_apis_publisher_id" ON "apis" ("publisher_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_apis_listed_created_at" ON "apis" ("listed","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_api_calls_api_id_created_at" ON "api_calls" ("api_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_api_calls_payer_address" ON "api_calls" ("payer_address");
