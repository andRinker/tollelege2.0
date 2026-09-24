ALTER TABLE "handovers" DROP CONSTRAINT "handovers_not_empty";--> statement-breakpoint
ALTER TABLE "handovers" ADD COLUMN "copy_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_not_empty" CHECK (cardinality("handovers"."class_ids") + cardinality("handovers"."book_ids") + cardinality("handovers"."copy_ids") > 0);