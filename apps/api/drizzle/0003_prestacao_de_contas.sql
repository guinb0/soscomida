CREATE TABLE "expense_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"expense_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"fiscal_document_id" uuid,
	"allocated_cents" bigint,
	"sharing_justification" text,
	"extraction_status" text NOT NULL,
	"extraction_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_documents_kind_check" CHECK ("expense_documents"."kind" in ('FISCAL', 'RECEIPT', 'PAYMENT_PROOF', 'DELIVERY', 'OTHER')),
	CONSTRAINT "expense_documents_extraction_check" CHECK ("expense_documents"."extraction_status" in ('EXTRACTED', 'NEEDS_ACCESS_KEY', 'NEEDS_TOTAL', 'NOT_APPLICABLE')),
	CONSTRAINT "expense_documents_allocation_positive" CHECK ("expense_documents"."allocated_cents" is null or "expense_documents"."allocated_cents" > 0),
	CONSTRAINT "expense_documents_fiscal_kind" CHECK ("expense_documents"."fiscal_document_id" is null or "expense_documents"."kind" = 'FISCAL'),
	CONSTRAINT "expense_documents_allocated_needs_fiscal" CHECK ("expense_documents"."allocated_cents" is null or "expense_documents"."fiscal_document_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "expense_status_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"expense_id" uuid NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" uuid,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"campaign_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"budget_category" text NOT NULL,
	"description" text NOT NULL,
	"supplier_name" text NOT NULL,
	"supplier_document" text,
	"amount_cents" bigint NOT NULL,
	"spent_on" date NOT NULL,
	"payment_proof" text DEFAULT 'NONE' NOT NULL,
	"delivery" text DEFAULT 'NONE' NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reviewer_id" uuid,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_status_check" CHECK ("expenses"."status" in ('DRAFT', 'SUBMITTED', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED')),
	CONSTRAINT "expenses_amount_positive" CHECK ("expenses"."amount_cents" > 0),
	CONSTRAINT "expenses_payment_proof_check" CHECK ("expenses"."payment_proof" in ('NONE', 'ATTACHED', 'ACCEPTED', 'REJECTED')),
	CONSTRAINT "expenses_delivery_check" CHECK ("expenses"."delivery" in ('NONE', 'ATTACHED', 'ACCEPTED', 'REJECTED'))
);
--> statement-breakpoint
CREATE TABLE "fiscal_document_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"description" text NOT NULL,
	"ncm" text,
	"cfop" text,
	"unit" text,
	"quantity" text,
	"total_cents" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fiscal_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"access_key" text NOT NULL,
	"model" text NOT NULL,
	"uf" text NOT NULL,
	"series" integer NOT NULL,
	"number" bigint NOT NULL,
	"issued_at" timestamp with time zone,
	"environment" smallint,
	"issuer_document" text NOT NULL,
	"issuer_name" text,
	"total_cents" bigint,
	"declared_total_cents" bigint,
	"source" text NOT NULL,
	"source_file_id" uuid,
	"protocol_status" integer,
	"protocol_number" text,
	"protocol_message" text,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verification_status" text DEFAULT 'NOT_VERIFIED' NOT NULL,
	"verification_reason" text,
	"verified_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_documents_key_format" CHECK ("fiscal_documents"."access_key" ~ '^[0-9]{44}$'),
	CONSTRAINT "fiscal_documents_model_check" CHECK ("fiscal_documents"."model" in ('NFE_55', 'NFCE_65')),
	CONSTRAINT "fiscal_documents_source_check" CHECK ("fiscal_documents"."source" in ('XML', 'QR_CODE', 'ACCESS_KEY')),
	CONSTRAINT "fiscal_documents_total_check" CHECK ("fiscal_documents"."total_cents" is null or "fiscal_documents"."total_cents" >= 0),
	CONSTRAINT "fiscal_documents_declared_check" CHECK ("fiscal_documents"."declared_total_cents" is null or "fiscal_documents"."declared_total_cents" > 0),
	CONSTRAINT "fiscal_documents_verification_check" CHECK ("fiscal_documents"."verification_status" in ('NOT_VERIFIED', 'AUTHORIZED', 'CANCELLED', 'NOT_FOUND', 'DIVERGENT', 'UNVERIFIABLE'))
);
--> statement-breakpoint
CREATE TABLE "fiscal_verifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"details" text,
	"evidence" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_verifications_status_check" CHECK ("fiscal_verifications"."status" in ('AUTHORIZED', 'CANCELLED', 'NOT_FOUND', 'DIVERGENT', 'UNVERIFIABLE'))
);
--> statement-breakpoint
ALTER TABLE "stored_files" DROP CONSTRAINT "stored_files_purpose_check";--> statement-breakpoint
ALTER TABLE "expense_documents" ADD CONSTRAINT "expense_documents_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_documents" ADD CONSTRAINT "expense_documents_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_documents" ADD CONSTRAINT "expense_documents_fiscal_document_id_fiscal_documents_id_fk" FOREIGN KEY ("fiscal_document_id") REFERENCES "public"."fiscal_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_status_history" ADD CONSTRAINT "expense_status_history_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_status_history" ADD CONSTRAINT "expense_status_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_document_items" ADD CONSTRAINT "fiscal_document_items_document_id_fiscal_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."fiscal_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_source_file_id_stored_files_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_verifications" ADD CONSTRAINT "fiscal_verifications_document_id_fiscal_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."fiscal_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expense_documents_file" ON "expense_documents" USING btree ("file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_documents_fiscal_once" ON "expense_documents" USING btree ("expense_id","fiscal_document_id") WHERE "expense_documents"."fiscal_document_id" is not null;--> statement-breakpoint
CREATE INDEX "expense_documents_fiscal_idx" ON "expense_documents" USING btree ("fiscal_document_id");--> statement-breakpoint
CREATE INDEX "expense_status_history_expense_idx" ON "expense_status_history" USING btree ("expense_id","occurred_at");--> statement-breakpoint
CREATE INDEX "expenses_campaign_idx" ON "expenses" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "expenses_queue_idx" ON "expenses" USING btree ("status","submitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_document_items_position" ON "fiscal_document_items" USING btree ("document_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_documents_access_key" ON "fiscal_documents" USING btree ("access_key");--> statement-breakpoint
CREATE INDEX "fiscal_documents_issuer_idx" ON "fiscal_documents" USING btree ("issuer_document");--> statement-breakpoint
CREATE INDEX "fiscal_verifications_document_idx" ON "fiscal_verifications" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE INDEX "stored_files_sha256_idx" ON "stored_files" USING btree ("sha256");--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_purpose_check" CHECK ("stored_files"."purpose" in ('campaign_image', 'expense_document'));--> statement-breakpoint
-- [manual] Histórico de status das despesas e tentativas de verificação fiscal
-- são só-inserção (função criada na 0000).
CREATE TRIGGER expense_status_history_immutable BEFORE UPDATE OR DELETE ON "expense_status_history"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER expense_status_history_no_truncate BEFORE TRUNCATE ON "expense_status_history"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER fiscal_verifications_immutable BEFORE UPDATE OR DELETE ON "fiscal_verifications"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER fiscal_verifications_no_truncate BEFORE TRUNCATE ON "fiscal_verifications"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
-- [manual] Rateio: a soma do que as despesas atribuem a uma nota não passa do
-- total da nota (lido do documento ou, na falta, declarado). Despesas
-- recusadas ou canceladas liberam a parte delas. Conferido no COMMIT; a API já
-- trava a nota (FOR UPDATE) antes de alocar — isto é a rede de segurança.
CREATE FUNCTION expense_allocation_within_total() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  total bigint;
  usado bigint;
BEGIN
  IF NEW.fiscal_document_id IS NULL OR NEW.allocated_cents IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT coalesce(total_cents, declared_total_cents) INTO total FROM fiscal_documents WHERE id = NEW.fiscal_document_id;
  IF total IS NULL THEN
    RAISE EXCEPTION 'Alocação em nota sem total conhecido (%)', NEW.fiscal_document_id USING ERRCODE = '23514';
  END IF;
  SELECT coalesce(sum(ed.allocated_cents), 0) INTO usado
    FROM expense_documents ed JOIN expenses e ON e.id = ed.expense_id
   WHERE ed.fiscal_document_id = NEW.fiscal_document_id AND e.status NOT IN ('REJECTED', 'CANCELLED');
  IF usado > total THEN
    RAISE EXCEPTION 'Rateio de % centavos passa do total % da nota %', usado, total, NEW.fiscal_document_id USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER expense_documents_allocation_limit AFTER INSERT OR UPDATE ON "expense_documents"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION expense_allocation_within_total();
