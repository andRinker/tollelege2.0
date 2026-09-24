CREATE TABLE "handovers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_teacher_id" text NOT NULL,
	"to_teacher_id" text NOT NULL,
	"class_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"book_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "handovers_distinct_teachers" CHECK ("handovers"."from_teacher_id" <> "handovers"."to_teacher_id"),
	CONSTRAINT "handovers_status_check" CHECK (status in ('pending','accepted','declined','withdrawn')),
	CONSTRAINT "handovers_not_empty" CHECK (cardinality("handovers"."class_ids") + cardinality("handovers"."book_ids") > 0)
);
--> statement-breakpoint
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_from_teacher_id_user_id_fk" FOREIGN KEY ("from_teacher_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_to_teacher_id_user_id_fk" FOREIGN KEY ("to_teacher_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "handovers_one_pending_per_sender" ON "handovers" USING btree ("from_teacher_id") WHERE "handovers"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "handovers_to_idx" ON "handovers" USING btree ("to_teacher_id","status");--> statement-breakpoint
-- Written by hand; drizzle can't declare deferrable foreign keys. Handing books and classes
-- to another teacher changes `teacher_id` on a parent and its children in one transaction.
-- With these keys checked at commit rather than per statement, the hand-over can rewrite
-- every row explicitly and the database still refuses the whole transaction unless every
-- row matches its parent when it ends. `INITIALLY IMMEDIATE` keeps them checked per
-- statement everywhere else, and ON DELETE actions are never deferred, so nothing else
-- changes. ALTER CONSTRAINT keeps each key's ON DELETE clause, including the column lists
-- on loans_copy_fk and loans_book_fk. If these keys are ever regenerated, carry this across.
ALTER TABLE "copies" ALTER CONSTRAINT "copies_book_fk" DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "students" ALTER CONSTRAINT "students_class_fk" DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "loans" ALTER CONSTRAINT "loans_copy_fk" DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "loans" ALTER CONSTRAINT "loans_book_fk" DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "loans" ALTER CONSTRAINT "loans_student_fk" DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "class_teachers" ALTER CONSTRAINT "class_teachers_class_fk" DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "class_teacher_invites" ALTER CONSTRAINT "class_teacher_invites_class_fk" DEFERRABLE INITIALLY IMMEDIATE;
