ALTER TABLE "tidy_runs" ADD COLUMN "confident" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tidy_runs" ADD COLUMN "batch_id" uuid;