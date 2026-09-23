ALTER TABLE "loans" DROP CONSTRAINT "loans_copy_fk";
--> statement-breakpoint
ALTER TABLE "loans" ALTER COLUMN "copy_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "book_id" uuid;--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "book_title" text;--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "book_authors" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
-- Every existing checkout still has its copy (deleting one with history was refused until
-- now), so each can be filled in from the book it points at before the column is required.
UPDATE "loans" SET "book_id" = "books"."id", "book_title" = "books"."title", "book_authors" = "books"."authors"
FROM "copies", "books"
WHERE "copies"."id" = "loans"."copy_id" AND "books"."id" = "copies"."book_id";--> statement-breakpoint
ALTER TABLE "loans" ALTER COLUMN "book_title" SET NOT NULL;--> statement-breakpoint
-- `SET NULL (col)` rather than plain `SET NULL`, which would also null "teacher_id" and fail.
ALTER TABLE "loans" ADD CONSTRAINT "loans_book_fk" FOREIGN KEY ("book_id","teacher_id") REFERENCES "public"."books"("id","teacher_id") ON DELETE SET NULL ("book_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_copy_fk" FOREIGN KEY ("copy_id","teacher_id") REFERENCES "public"."copies"("id","teacher_id") ON DELETE SET NULL ("copy_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "loans_book_idx" ON "loans" USING btree ("book_id");--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_open_has_copy" CHECK ("loans"."closed_at" is not null or "loans"."copy_id" is not null);
