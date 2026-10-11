CREATE TABLE "campaign_budget_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"campaign_id" uuid NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"planned_cents" bigint NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "campaign_budget_items_planned_positive" CHECK ("campaign_budget_items"."planned_cents" > 0),
	CONSTRAINT "campaign_budget_items_category_check" CHECK ("campaign_budget_items"."category" in ('ALIMENTOS', 'MEDICAMENTOS', 'SERVICOS_SAUDE', 'VETERINARIO', 'TRANSPORTE', 'EMBALAGENS', 'MATERIAIS', 'SERVICOS', 'MORADIA', 'EDUCACAO', 'OUTROS'))
);
--> statement-breakpoint
CREATE TABLE "campaign_images" (
	"campaign_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_stats" (
	"campaign_id" uuid PRIMARY KEY NOT NULL,
	"confirmed_cents" bigint DEFAULT 0 NOT NULL,
	"fees_cents" bigint DEFAULT 0 NOT NULL,
	"refunds_cents" bigint DEFAULT 0 NOT NULL,
	"donations_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_status_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"campaign_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" uuid,
	"actor_role" text NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_updates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"campaign_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"organizer_id" uuid NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"goal_cents" bigint NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"region" text,
	"ends_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"cover_file_id" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "campaigns_goal_positive" CHECK ("campaigns"."goal_cents" > 0),
	CONSTRAINT "campaigns_status_check" CHECK ("campaigns"."status" in ('DRAFT', 'PENDING_REVIEW', 'IN_REVIEW', 'APPROVED', 'ACTIVE', 'PAUSED', 'ENDED', 'CANCELLED', 'UNDER_INVESTIGATION')),
	CONSTRAINT "campaigns_category_check" CHECK ("campaigns"."category" in ('SAUDE', 'ALIMENTACAO', 'ANIMAIS', 'EDUCACAO', 'EMERGENCIAS', 'PROJETOS_SOCIAIS', 'HABITACAO', 'OUTRAS'))
);
--> statement-breakpoint
CREATE TABLE "donations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"campaign_id" uuid NOT NULL,
	"donor_user_id" uuid,
	"display_name" text,
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"amount_cents" bigint NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "donations_status_check" CHECK ("donations"."status" in ('PENDING', 'CONFIRMED', 'EXPIRED', 'FAILED', 'REFUNDED')),
	CONSTRAINT "donations_amount_range" CHECK (amount_cents between 500 and 5000000)
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"campaign_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_accounts_kind_check" CHECK ("ledger_accounts"."kind" in ('ASSET', 'LIABILITY', 'REVENUE', 'EXPENSE'))
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"transaction_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	CONSTRAINT "ledger_entries_direction_check" CHECK ("ledger_entries"."direction" in ('DEBIT', 'CREDIT')),
	CONSTRAINT "ledger_entries_amount_positive" CHECK ("ledger_entries"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"reference_type" text NOT NULL,
	"reference_id" text NOT NULL,
	"campaign_id" uuid,
	"description" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moderation_cases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"campaign_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"assigned_to" uuid,
	"decision" text,
	"reason" text,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "moderation_cases_kind_check" CHECK ("moderation_cases"."kind" in ('CAMPAIGN_REVIEW', 'INVESTIGATION')),
	CONSTRAINT "moderation_cases_status_check" CHECK ("moderation_cases"."status" in ('OPEN', 'CLOSED'))
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"provider_payment_id" text,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'RECEIVED' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"result" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "payment_events_status_check" CHECK ("payment_events"."status" in ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED'))
);
--> statement-breakpoint
CREATE TABLE "payment_intents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reference_type" text NOT NULL,
	"reference_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_payment_id" text,
	"method" text DEFAULT 'PIX' NOT NULL,
	"amount_cents" bigint NOT NULL,
	"fee_cents" bigint,
	"net_cents" bigint,
	"status" text DEFAULT 'CREATED' NOT NULL,
	"pix_copy_paste" text,
	"expires_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"failure_reason" text,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_intents_status_check" CHECK ("payment_intents"."status" in ('CREATED', 'AWAITING_PAYMENT', 'CONFIRMED', 'REFUNDED', 'EXPIRED', 'FAILED')),
	CONSTRAINT "payment_intents_amount_positive" CHECK ("payment_intents"."amount_cents" > 0),
	CONSTRAINT "payment_intents_fee_range" CHECK ("payment_intents"."fee_cents" is null or ("payment_intents"."fee_cents" >= 0 and "payment_intents"."fee_cents" <= "payment_intents"."amount_cents"))
);
--> statement-breakpoint
CREATE TABLE "stored_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"bucket" text NOT NULL,
	"object_key" text NOT NULL,
	"declared_mime_type" text NOT NULL,
	"declared_size_bytes" bigint NOT NULL,
	"detected_mime_type" text,
	"sha256" text,
	"status" text DEFAULT 'PENDING_UPLOAD' NOT NULL,
	"rejection_reason" text,
	"public_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"validated_at" timestamp with time zone,
	CONSTRAINT "stored_files_status_check" CHECK ("stored_files"."status" in ('PENDING_UPLOAD', 'VALIDATED', 'REJECTED')),
	CONSTRAINT "stored_files_purpose_check" CHECK ("stored_files"."purpose" in ('campaign_image')),
	CONSTRAINT "stored_files_size_check" CHECK ("stored_files"."declared_size_bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "campaign_budget_items" ADD CONSTRAINT "campaign_budget_items_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_images" ADD CONSTRAINT "campaign_images_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_images" ADD CONSTRAINT "campaign_images_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_stats" ADD CONSTRAINT "campaign_stats_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_status_history" ADD CONSTRAINT "campaign_status_history_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_updates" ADD CONSTRAINT "campaign_updates_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_updates" ADD CONSTRAINT "campaign_updates_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organizer_id_users_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_cover_file_id_stored_files_id_fk" FOREIGN KEY ("cover_file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_donor_user_id_users_id_fk" FOREIGN KEY ("donor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_budget_items_campaign_idx" ON "campaign_budget_items" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_images_pk" ON "campaign_images" USING btree ("campaign_id","file_id");--> statement-breakpoint
CREATE INDEX "campaign_status_history_campaign_idx" ON "campaign_status_history" USING btree ("campaign_id","occurred_at");--> statement-breakpoint
CREATE INDEX "campaign_updates_campaign_idx" ON "campaign_updates" USING btree ("campaign_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_slug_key" ON "campaigns" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "campaigns_organizer_idx" ON "campaigns" USING btree ("organizer_id");--> statement-breakpoint
CREATE INDEX "campaigns_status_idx" ON "campaigns" USING btree ("status","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "donations_idempotency_key" ON "donations" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "donations_campaign_idx" ON "donations" USING btree ("campaign_id","status","confirmed_at");--> statement-breakpoint
CREATE INDEX "donations_donor_idx" ON "donations" USING btree ("donor_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_code_key" ON "ledger_accounts" USING btree ("code");--> statement-breakpoint
CREATE INDEX "ledger_accounts_campaign_idx" ON "ledger_accounts" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_transaction_idx" ON "ledger_entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_account_idx" ON "ledger_entries" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_transactions_idempotency_key" ON "ledger_transactions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "ledger_transactions_campaign_idx" ON "ledger_transactions" USING btree ("campaign_id","kind");--> statement-breakpoint
CREATE INDEX "ledger_transactions_reference_idx" ON "ledger_transactions" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE UNIQUE INDEX "moderation_cases_one_open" ON "moderation_cases" USING btree ("campaign_id","kind") WHERE "moderation_cases"."status" = 'OPEN';--> statement-breakpoint
CREATE INDEX "moderation_cases_assigned_idx" ON "moderation_cases" USING btree ("assigned_to");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_provider_event_key" ON "payment_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "payment_events_payment_idx" ON "payment_events" USING btree ("provider","provider_payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_intents_reference_key" ON "payment_intents" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_intents_provider_payment_key" ON "payment_intents" USING btree ("provider","provider_payment_id");--> statement-breakpoint
CREATE INDEX "payment_intents_status_idx" ON "payment_intents" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stored_files_object_key" ON "stored_files" USING btree ("bucket","object_key");--> statement-breakpoint
CREATE INDEX "stored_files_owner_idx" ON "stored_files" USING btree ("owner_user_id");--> statement-breakpoint
-- [manual] Ledger e histórico de status são só-inserção (função criada na 0000).
CREATE TRIGGER ledger_transactions_immutable BEFORE UPDATE OR DELETE ON "ledger_transactions"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER ledger_transactions_no_truncate BEFORE TRUNCATE ON "ledger_transactions"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER ledger_entries_immutable BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER ledger_entries_no_truncate BEFORE TRUNCATE ON "ledger_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER campaign_status_history_immutable BEFORE UPDATE OR DELETE ON "campaign_status_history"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
-- [manual] Toda transação do ledger fecha débitos = créditos e tem ao menos dois
-- lançamentos. Conferido no COMMIT (constraint trigger diferida): os
-- lançamentos de uma transação são inseridos em sequência dentro dela.
CREATE FUNCTION ledger_assert_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  debitos bigint;
  creditos bigint;
  linhas int;
BEGIN
  SELECT coalesce(sum(CASE WHEN direction = 'DEBIT' THEN amount_cents ELSE 0 END), 0),
         coalesce(sum(CASE WHEN direction = 'CREDIT' THEN amount_cents ELSE 0 END), 0),
         count(*)
    INTO debitos, creditos, linhas
    FROM ledger_entries
   WHERE transaction_id = NEW.id;
  IF linhas < 2 OR debitos <> creditos THEN
    RAISE EXCEPTION 'Transação % do ledger desbalanceada (débitos %, créditos %, lançamentos %)', NEW.id, debitos, creditos, linhas
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_transactions_balanced AFTER INSERT ON "ledger_transactions"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_assert_balanced();
