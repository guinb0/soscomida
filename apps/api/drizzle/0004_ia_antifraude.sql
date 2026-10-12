CREATE TABLE "ai_calls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"purpose" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"prompt_version" text NOT NULL,
	"status" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_millicents" bigint DEFAULT 0 NOT NULL,
	"latency_ms" integer NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_calls_status_check" CHECK ("ai_calls"."status" in ('OK', 'INVALID_OUTPUT', 'ERROR')),
	CONSTRAINT "ai_calls_cost_check" CHECK ("ai_calls"."cost_millicents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "expense_analyses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"expense_id" uuid NOT NULL,
	"expense_version" integer NOT NULL,
	"trigger" text NOT NULL,
	"source_event_id" uuid,
	"requested_by" uuid,
	"ruleset_version" text NOT NULL,
	"risk_score" smallint NOT NULL,
	"risk_level" text NOT NULL,
	"risk_factors" jsonb NOT NULL,
	"suspicious_instructions" jsonb NOT NULL,
	"ai_status" text NOT NULL,
	"ai_provider" text NOT NULL,
	"ai_model" text,
	"prompt_version" text NOT NULL,
	"ai_output" jsonb,
	"ai_detail" text,
	"input_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_analyses_trigger_check" CHECK ("expense_analyses"."trigger" in ('SUBMITTED', 'MANUAL')),
	CONSTRAINT "expense_analyses_level_check" CHECK ("expense_analyses"."risk_level" in ('LOW', 'MEDIUM', 'HIGH')),
	CONSTRAINT "expense_analyses_ai_status_check" CHECK ("expense_analyses"."ai_status" in ('COMPLETED', 'NO_PROVIDER', 'BUDGET_EXHAUSTED', 'INVALID_OUTPUT', 'PROVIDER_ERROR'))
);
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "rejected_by" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "appeal_reason" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "appealed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "risk_score" smallint;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "risk_level" text;--> statement-breakpoint
ALTER TABLE "fiscal_documents" ADD COLUMN "signature_status" text;--> statement-breakpoint
ALTER TABLE "fiscal_documents" ADD COLUMN "signature_details" jsonb;--> statement-breakpoint
ALTER TABLE "stored_files" ADD COLUMN "perceptual_hash" text;--> statement-breakpoint
ALTER TABLE "expense_analyses" ADD CONSTRAINT "expense_analyses_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_analyses" ADD CONSTRAINT "expense_analyses_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_calls_created_idx" ON "ai_calls" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_calls_subject_idx" ON "ai_calls" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "expense_analyses_expense_idx" ON "expense_analyses" USING btree ("expense_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_analyses_event" ON "expense_analyses" USING btree ("source_event_id") WHERE "expense_analyses"."source_event_id" is not null;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_risk_check" CHECK (("expenses"."risk_score" is null and "expenses"."risk_level" is null) or ("expenses"."risk_score" between 0 and 100 and "expenses"."risk_level" in ('LOW', 'MEDIUM', 'HIGH')));--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_appeal_check" CHECK (("expenses"."appealed_at" is null) = ("expenses"."appeal_reason" is null));--> statement-breakpoint
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_signature_check" CHECK ("fiscal_documents"."signature_status" is null or "fiscal_documents"."signature_status" in ('VALID', 'MISSING', 'INVALID'));--> statement-breakpoint
-- [manual] Análises de despesas e chamadas de IA são registros de auditoria:
-- só inserção (função criada na 0000).
CREATE TRIGGER expense_analyses_immutable BEFORE UPDATE OR DELETE ON "expense_analyses"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER expense_analyses_no_truncate BEFORE TRUNCATE ON "expense_analyses"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER ai_calls_immutable BEFORE UPDATE OR DELETE ON "ai_calls"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER ai_calls_no_truncate BEFORE TRUNCATE ON "ai_calls"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
