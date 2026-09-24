ALTER TABLE "handovers" DROP CONSTRAINT "handovers_not_empty";--> statement-breakpoint
ALTER TABLE "handovers" ALTER COLUMN "to_teacher_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "handovers" ADD COLUMN "to_email" text;--> statement-breakpoint
ALTER TABLE "handovers" ADD COLUMN "everything" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "handovers_to_email_idx" ON "handovers" USING btree ("to_email");--> statement-breakpoint
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_has_recipient" CHECK ("handovers"."to_teacher_id" is not null or "handovers"."to_email" is not null);--> statement-breakpoint
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_to_email_lower" CHECK ("handovers"."to_email" = lower("handovers"."to_email"));--> statement-breakpoint
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_not_empty" CHECK ("handovers"."everything" or cardinality("handovers"."class_ids") + cardinality("handovers"."book_ids") + cardinality("handovers"."copy_ids") > 0);