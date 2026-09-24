CREATE TABLE "class_teacher_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_id" uuid NOT NULL,
	"owner_teacher_id" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_teacher_invites_one_per_class" UNIQUE("class_id","email"),
	CONSTRAINT "class_teacher_invites_email_lower" CHECK ("class_teacher_invites"."email" = lower("class_teacher_invites"."email"))
);
--> statement-breakpoint
CREATE TABLE "class_teachers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_id" uuid NOT NULL,
	"owner_teacher_id" text NOT NULL,
	"co_teacher_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_teachers_one_per_class" UNIQUE("class_id","co_teacher_id"),
	CONSTRAINT "class_teachers_not_self" CHECK ("class_teachers"."owner_teacher_id" <> "class_teachers"."co_teacher_id")
);
--> statement-breakpoint
ALTER TABLE "class_teacher_invites" ADD CONSTRAINT "class_teacher_invites_owner_teacher_id_user_id_fk" FOREIGN KEY ("owner_teacher_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_teacher_invites" ADD CONSTRAINT "class_teacher_invites_class_fk" FOREIGN KEY ("class_id","owner_teacher_id") REFERENCES "public"."classes"("id","teacher_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_teachers" ADD CONSTRAINT "class_teachers_owner_teacher_id_user_id_fk" FOREIGN KEY ("owner_teacher_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_teachers" ADD CONSTRAINT "class_teachers_co_teacher_id_user_id_fk" FOREIGN KEY ("co_teacher_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_teachers" ADD CONSTRAINT "class_teachers_class_fk" FOREIGN KEY ("class_id","owner_teacher_id") REFERENCES "public"."classes"("id","teacher_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_teacher_invites_email_idx" ON "class_teacher_invites" USING btree ("email");--> statement-breakpoint
CREATE INDEX "class_teachers_co_idx" ON "class_teachers" USING btree ("co_teacher_id","owner_teacher_id");