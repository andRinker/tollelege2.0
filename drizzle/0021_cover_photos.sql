CREATE TABLE "book_cover_photos" (
	"book_id" uuid PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"image" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_cover_photos_id_teacher_unique" UNIQUE("book_id","teacher_id")
);
--> statement-breakpoint
ALTER TABLE "book_cover_photos" ADD CONSTRAINT "book_cover_photos_teacher_id_user_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Hand-edited: DEFERRABLE, so a hand-over can rewrite teacher_id on the title and its photo in one transaction.
ALTER TABLE "book_cover_photos" ADD CONSTRAINT "book_cover_photos_book_fk" FOREIGN KEY ("book_id","teacher_id") REFERENCES "public"."books"("id","teacher_id") ON DELETE cascade ON UPDATE no action DEFERRABLE INITIALLY IMMEDIATE;
