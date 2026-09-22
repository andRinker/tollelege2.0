CREATE TABLE "scan_events" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"scan_session_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scan_events_kind_check" CHECK (kind in ('book_added','lookup_failed','shelf_proposed'))
);
--> statement-breakpoint
CREATE TABLE "scan_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"device_id" text,
	"device_label" text,
	"claimed_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scan_sessions_id_teacher_unique" UNIQUE("id","teacher_id"),
	CONSTRAINT "scan_sessions_token_unique" UNIQUE("token_hash"),
	CONSTRAINT "scan_sessions_claim_consistency" CHECK (("scan_sessions"."claimed_at" is null) = ("scan_sessions"."device_id" is null))
);
--> statement-breakpoint
ALTER TABLE "scan_events" ADD CONSTRAINT "scan_events_teacher_id_user_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_events" ADD CONSTRAINT "scan_events_session_fk" FOREIGN KEY ("scan_session_id","teacher_id") REFERENCES "public"."scan_sessions"("id","teacher_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_sessions" ADD CONSTRAINT "scan_sessions_teacher_id_user_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scan_events_teacher_idx" ON "scan_events" USING btree ("teacher_id","seq");--> statement-breakpoint
CREATE INDEX "scan_sessions_teacher_idx" ON "scan_sessions" USING btree ("teacher_id","expires_at");