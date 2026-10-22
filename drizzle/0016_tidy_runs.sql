CREATE TABLE "tidy_runs" (
	"teacher_id" text PRIMARY KEY NOT NULL,
	"after" uuid,
	"checked" integer DEFAULT 0 NOT NULL,
	"remaining" integer NOT NULL,
	"suggestions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"finished_at" timestamp with time zone,
	"claimed_until" timestamp with time zone,
	"last_error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tidy_runs" ADD CONSTRAINT "tidy_runs_teacher_id_user_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;