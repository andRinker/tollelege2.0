CREATE TABLE "genres" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "genres_id_teacher_unique" UNIQUE("id","teacher_id"),
	CONSTRAINT "genres_color_check" CHECK (color in ('green','blue','orange','red','pink','yellow','purple','teal','brown','grey'))
);
--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "genre_id" uuid;--> statement-breakpoint
ALTER TABLE "teacher_settings" ADD COLUMN "genres_seeded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "genres" ADD CONSTRAINT "genres_teacher_id_user_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "genres_teacher_name_unique" ON "genres" USING btree ("teacher_id",lower("name"));--> statement-breakpoint
-- Written by hand, as in 0003 and 0007: `SET NULL ("genre_id")` rather than drizzle's plain
-- SET NULL, which would null "teacher_id" too and fail; and DEFERRABLE, like the other
-- ownership keys, because accepting a hand-over rewrites teacher_id before it remaps genres.
ALTER TABLE "books" ADD CONSTRAINT "books_genre_fk" FOREIGN KEY ("genre_id","teacher_id") REFERENCES "public"."genres"("id","teacher_id") ON DELETE SET NULL ("genre_id") ON UPDATE no action DEFERRABLE INITIALLY IMMEDIATE;