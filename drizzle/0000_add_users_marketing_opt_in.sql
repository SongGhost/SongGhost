ALTER TABLE "users" ADD COLUMN "marketing_opt_in" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "marketing_opt_in_at" timestamp with time zone;
