CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_id" text NOT NULL,
	"isbn13" text,
	"title" text NOT NULL,
	"subtitle" text,
	"authors" text[] DEFAULT '{}'::text[] NOT NULL,
	"description" text,
	"cover_url" text,
	"publisher" text,
	"published_year" integer,
	"page_count" integer,
	"reading_level" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"location" text,
	"notes" text,
	"metadata_source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "books_id_teacher_unique" UNIQUE("id","teacher_id"),
	CONSTRAINT "books_isbn13_format" CHECK ("books"."isbn13" is null or "books"."isbn13" ~ '^97[89][0-9]{10}$'),
	CONSTRAINT "books_metadata_source_check" CHECK (metadata_source in ('openlibrary','google_books','manual'))
);
--> statement-breakpoint
CREATE TABLE "copies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_id" text NOT NULL,
	"book_id" uuid NOT NULL,
	"copy_number" integer NOT NULL,
	"status" text DEFAULT 'in_circulation' NOT NULL,
	"condition_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "copies_id_teacher_unique" UNIQUE("id","teacher_id"),
	CONSTRAINT "copies_book_number_unique" UNIQUE("book_id","copy_number"),
	CONSTRAINT "copies_status_check" CHECK (status in ('in_circulation','lost','damaged','withdrawn')),
	CONSTRAINT "copies_copy_number_positive" CHECK ("copies"."copy_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "loans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_id" text NOT NULL,
	"copy_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"checked_out_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_on" date,
	"closed_at" timestamp with time zone,
	"close_reason" text,
	CONSTRAINT "loans_close_consistency" CHECK (("loans"."closed_at" is null) = ("loans"."close_reason" is null)),
	CONSTRAINT "loans_close_reason_check" CHECK (close_reason is null or close_reason in ('returned','lost'))
);
--> statement-breakpoint
CREATE TABLE "isbn_lookup_cache" (
	"isbn13" text PRIMARY KEY NOT NULL,
	"payload" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_id" text NOT NULL,
	"name" text NOT NULL,
	"school_year" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classes_id_teacher_unique" UNIQUE("id","teacher_id")
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_id" text NOT NULL,
	"class_id" uuid,
	"first_name" text NOT NULL,
	"last_name" text DEFAULT '' NOT NULL,
	"student_number" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "students_id_teacher_unique" UNIQUE("id","teacher_id")
);
--> statement-breakpoint
CREATE TABLE "teacher_settings" (
	"teacher_id" text PRIMARY KEY NOT NULL,
	"loan_period_days" integer DEFAULT 14,
	"max_books_per_student" integer,
	"reading_level_system" text DEFAULT 'none' NOT NULL,
	"time_zone" text,
	"theme_seed_color" text,
	"theme_mode" text DEFAULT 'system' NOT NULL,
	"theme_contrast" text DEFAULT 'standard' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teacher_settings_loan_period_range" CHECK ("teacher_settings"."loan_period_days" is null or "teacher_settings"."loan_period_days" between 1 and 365),
	CONSTRAINT "teacher_settings_max_books_range" CHECK ("teacher_settings"."max_books_per_student" is null or "teacher_settings"."max_books_per_student" between 1 and 50),
	CONSTRAINT "teacher_settings_reading_level_system_check" CHECK (reading_level_system in ('none','lexile','guided_reading','atos','grade_level','other')),
	CONSTRAINT "teacher_settings_theme_mode_check" CHECK (theme_mode in ('system','light','dark')),
	CONSTRAINT "teacher_settings_theme_contrast_check" CHECK (theme_contrast in ('standard','medium','high')),
	CONSTRAINT "teacher_settings_theme_seed_color_format" CHECK ("teacher_settings"."theme_seed_color" is null or "teacher_settings"."theme_seed_color" ~ '^#[0-9a-fA-F]{6}$')
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_teacher_id_user_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copies" ADD CONSTRAINT "copies_teacher_id_user_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copies" ADD CONSTRAINT "copies_book_fk" FOREIGN KEY ("book_id","teacher_id") REFERENCES "public"."books"("id","teacher_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_teacher_id_user_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_copy_fk" FOREIGN KEY ("copy_id","teacher_id") REFERENCES "public"."copies"("id","teacher_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_student_fk" FOREIGN KEY ("student_id","teacher_id") REFERENCES "public"."students"("id","teacher_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_teacher_id_user_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_teacher_id_user_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_class_fk" FOREIGN KEY ("class_id","teacher_id") REFERENCES "public"."classes"("id","teacher_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_settings" ADD CONSTRAINT "teacher_settings_teacher_id_user_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "books_teacher_isbn_unique" ON "books" USING btree ("teacher_id","isbn13") WHERE "books"."isbn13" is not null;--> statement-breakpoint
CREATE INDEX "books_teacher_title_idx" ON "books" USING btree ("teacher_id","title");--> statement-breakpoint
CREATE INDEX "copies_teacher_book_idx" ON "copies" USING btree ("teacher_id","book_id");--> statement-breakpoint
CREATE UNIQUE INDEX "loans_one_open_per_copy" ON "loans" USING btree ("copy_id") WHERE "loans"."closed_at" is null;--> statement-breakpoint
CREATE INDEX "loans_teacher_closed_idx" ON "loans" USING btree ("teacher_id","closed_at");--> statement-breakpoint
CREATE INDEX "loans_student_closed_idx" ON "loans" USING btree ("student_id","closed_at");--> statement-breakpoint
CREATE INDEX "loans_copy_idx" ON "loans" USING btree ("copy_id");--> statement-breakpoint
CREATE INDEX "classes_teacher_idx" ON "classes" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "students_teacher_class_idx" ON "students" USING btree ("teacher_id","class_id");--> statement-breakpoint
CREATE UNIQUE INDEX "students_teacher_number_unique" ON "students" USING btree ("teacher_id","student_number") WHERE "students"."student_number" is not null;