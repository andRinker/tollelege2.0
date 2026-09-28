ALTER TABLE "books" ADD COLUMN "series" text;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "series_number" real;--> statement-breakpoint
CREATE INDEX "books_teacher_series_idx" ON "books" USING btree ("teacher_id",lower("series"));--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_series_number_range" CHECK ("books"."series_number" is null or "books"."series_number" between 0 and 9999);