CREATE TABLE "email_notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"dedupe_key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"template" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"provider_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "email_notifications_status_check" CHECK ("email_notifications"."status" in ('PENDING', 'SENT', 'SKIPPED'))
);
--> statement-breakpoint
ALTER TABLE "email_notifications" ADD CONSTRAINT "email_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_notifications_dedupe_key" ON "email_notifications" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "email_notifications_user_idx" ON "email_notifications" USING btree ("user_id","created_at");