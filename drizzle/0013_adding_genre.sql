ALTER TABLE "teacher_settings" ADD COLUMN "adding_genre_id" uuid;--> statement-breakpoint
-- Hand-edited: ON DELETE SET NULL ("adding_genre_id") names the column, because a plain
-- SET NULL would also null teacher_id, which is the primary key. drizzle can't write it.
ALTER TABLE "teacher_settings" ADD CONSTRAINT "teacher_settings_adding_genre_fk" FOREIGN KEY ("adding_genre_id","teacher_id") REFERENCES "public"."genres"("id","teacher_id") ON DELETE SET NULL ("adding_genre_id") ON UPDATE no action;
