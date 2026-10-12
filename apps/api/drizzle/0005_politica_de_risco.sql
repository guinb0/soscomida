CREATE TABLE "risk_policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"rules" jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "risk_policies_version_positive" CHECK ("risk_policies"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "risk_policies" ADD CONSTRAINT "risk_policies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "risk_policies_version" ON "risk_policies" USING btree ("version");
--> statement-breakpoint
-- [manual] Versões da política de risco: só inserção (função criada na 0000).
CREATE TRIGGER risk_policies_immutable BEFORE UPDATE OR DELETE ON "risk_policies"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER risk_policies_no_truncate BEFORE TRUNCATE ON "risk_policies"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
