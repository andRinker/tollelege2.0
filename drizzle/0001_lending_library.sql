CREATE TABLE "shelf_loans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_teacher_id" text NOT NULL,
	"borrower_teacher_id" text NOT NULL,
	"book_id" uuid NOT NULL,
	"copy_id" uuid,
	"borrower_copy_id" uuid,
	"status" text DEFAULT 'requested' NOT NULL,
	"message" text,
	"due_on" date,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
	CONSTRAINT "shelf_loans_status_check" CHECK (status in ('requested','declined','cancelled','active','returned')),
	CONSTRAINT "shelf_loans_distinct_teachers" CHECK ("shelf_loans"."owner_teacher_id" <> "shelf_loans"."borrower_teacher_id"),
	CONSTRAINT "shelf_loans_active_has_copies" CHECK ("shelf_loans"."status" <> 'active' or ("shelf_loans"."copy_id" is not null and "shelf_loans"."borrower_copy_id" is not null)),
	CONSTRAINT "shelf_loans_returned_at_consistency" CHECK (("shelf_loans"."status" = 'returned') = ("shelf_loans"."returned_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "teacher_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_a_id" text NOT NULL,
	"teacher_b_id" text NOT NULL,
	"requested_by_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "teacher_connections_ordered" CHECK ("teacher_connections"."teacher_a_id" < "teacher_connections"."teacher_b_id"),
	CONSTRAINT "teacher_connections_requester_member" CHECK ("teacher_connections"."requested_by_id" in ("teacher_connections"."teacher_a_id", "teacher_connections"."teacher_b_id")),
	CONSTRAINT "teacher_connections_status_check" CHECK (status in ('pending','accepted')),
	CONSTRAINT "teacher_connections_response_consistency" CHECK (("teacher_connections"."status" = 'pending') = ("teacher_connections"."responded_at" is null))
);
--> statement-breakpoint
ALTER TABLE "copies" DROP CONSTRAINT "copies_status_check";--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "lendable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "shelf_loans" ADD CONSTRAINT "shelf_loans_owner_teacher_id_user_id_fk" FOREIGN KEY ("owner_teacher_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shelf_loans" ADD CONSTRAINT "shelf_loans_borrower_teacher_id_user_id_fk" FOREIGN KEY ("borrower_teacher_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shelf_loans" ADD CONSTRAINT "shelf_loans_book_fk" FOREIGN KEY ("book_id","owner_teacher_id") REFERENCES "public"."books"("id","teacher_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shelf_loans" ADD CONSTRAINT "shelf_loans_copy_fk" FOREIGN KEY ("copy_id","owner_teacher_id") REFERENCES "public"."copies"("id","teacher_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shelf_loans" ADD CONSTRAINT "shelf_loans_borrower_copy_fk" FOREIGN KEY ("borrower_copy_id","borrower_teacher_id") REFERENCES "public"."copies"("id","teacher_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_connections" ADD CONSTRAINT "teacher_connections_teacher_a_id_user_id_fk" FOREIGN KEY ("teacher_a_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_connections" ADD CONSTRAINT "teacher_connections_teacher_b_id_user_id_fk" FOREIGN KEY ("teacher_b_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_connections" ADD CONSTRAINT "teacher_connections_requested_by_id_user_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shelf_loans_one_request_per_title" ON "shelf_loans" USING btree ("book_id","borrower_teacher_id") WHERE "shelf_loans"."status" = 'requested';--> statement-breakpoint
CREATE UNIQUE INDEX "shelf_loans_one_active_per_copy" ON "shelf_loans" USING btree ("copy_id") WHERE "shelf_loans"."status" = 'active';--> statement-breakpoint
CREATE INDEX "shelf_loans_owner_idx" ON "shelf_loans" USING btree ("owner_teacher_id","status");--> statement-breakpoint
CREATE INDEX "shelf_loans_borrower_idx" ON "shelf_loans" USING btree ("borrower_teacher_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_connections_pair_unique" ON "teacher_connections" USING btree ("teacher_a_id","teacher_b_id");--> statement-breakpoint
CREATE INDEX "teacher_connections_b_idx" ON "teacher_connections" USING btree ("teacher_b_id","status");--> statement-breakpoint
ALTER TABLE "copies" ADD CONSTRAINT "copies_status_check" CHECK (status in ('in_circulation','lent_out','lost','damaged','withdrawn'));