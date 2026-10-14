CREATE TYPE "base"."absence_status" AS ENUM('A_COMPLETER', 'ANTICIPEE', 'A_VALIDER', 'A_SAISIR', 'DANS_PAYFIT', 'REJETEE', 'ANNULEE');--> statement-breakpoint
CREATE TYPE "base"."half_day" AS ENUM('MATIN', 'APRES_MIDI');--> statement-breakpoint
CREATE TYPE "base"."evp_role" AS ENUM('DIRECTRICE', 'RO', 'RH', 'ADMINISTRATRICE', 'SUPERADMIN');--> statement-breakpoint
CREATE TYPE "base"."piece_status" AS ENUM('AUTHORIZED', 'CONFIRMED');--> statement-breakpoint
CREATE TYPE "base"."source_key" AS ENUM('sheets', 'payfit', 'aqoona', 'all');--> statement-breakpoint
CREATE TYPE "base"."source_run_state" AS ENUM('RUNNING', 'UP_TO_DATE', 'ERROR');--> statement-breakpoint
CREATE TABLE "base"."absence_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"absence_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"by_user_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "base"."absence_types" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"expected_piece" text,
	"private_piece" boolean DEFAULT false NOT NULL,
	"hr_review" boolean DEFAULT false NOT NULL,
	"payfit_code" text,
	"payfit_compatible_codes" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "base"."absences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creche_code" text NOT NULL,
	"scope_code" text NOT NULL,
	"contract_id" uuid NOT NULL,
	"type_code" text NOT NULL,
	"start_date" date NOT NULL,
	"start_half" "base"."half_day" NOT NULL,
	"end_date" date NOT NULL,
	"end_half" "base"."half_day" NOT NULL,
	"status" "base"."absence_status" NOT NULL,
	"saisie_declaree" boolean DEFAULT false NOT NULL,
	"comment" text,
	"payroll_month" text NOT NULL,
	"blockages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_decision" jsonb,
	"declared_by" uuid NOT NULL,
	"declared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "base"."payfit_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"absence_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"change" text NOT NULL,
	"fingerprint" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "base"."payfit_proofs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"absence_id" uuid NOT NULL,
	"company_id" text NOT NULL,
	"company_name" text NOT NULL,
	"siret" text NOT NULL,
	"payfit_contract_id" text NOT NULL,
	"payfit_absence_id" text NOT NULL,
	"code" text NOT NULL,
	"source_status" text NOT NULL,
	"start_date" date NOT NULL,
	"start_half" "base"."half_day" NOT NULL,
	"end_date" date NOT NULL,
	"end_half" "base"."half_day" NOT NULL,
	"observed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "base"."creche_assignments" (
	"user_id" uuid NOT NULL,
	"creche_code" text NOT NULL,
	CONSTRAINT "creche_assignments_user_id_creche_code_pk" PRIMARY KEY("user_id","creche_code")
);
--> statement-breakpoint
CREATE TABLE "base"."evp_accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" "base"."evp_role" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "base"."closures" (
	"creche_code" text NOT NULL,
	"month" text NOT NULL,
	"scope_code" text NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_by" uuid NOT NULL,
	CONSTRAINT "closures_creche_code_month_pk" PRIMARY KEY("creche_code","month")
);
--> statement-breakpoint
CREATE TABLE "base"."creches" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"siret" text NOT NULL,
	"directrice_name" text,
	"ro_names" text[] DEFAULT '{}' NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"scope_code" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "base"."absence_pieces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creche_code" text NOT NULL,
	"scope_code" text NOT NULL,
	"absence_id" uuid,
	"uploaded_by" uuid NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"announced_size" integer NOT NULL,
	"size_bytes" bigint,
	"storage_key" text NOT NULL,
	"final_key" text,
	"status" "base"."piece_status" DEFAULT 'AUTHORIZED' NOT NULL,
	"private_piece" boolean DEFAULT false NOT NULL,
	"upload_expires_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"attached_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "base"."notification_reads" (
	"notification_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_reads_notification_id_user_id_pk" PRIMARY KEY("notification_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "base"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"absence_id" uuid NOT NULL,
	"scope_code" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "base"."aqoona_mismatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_ref" text NOT NULL,
	"creche_name" text NOT NULL,
	"reason" text NOT NULL,
	"day" date
);
--> statement-breakpoint
CREATE TABLE "base"."aqoona_plannings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_ref" text NOT NULL,
	"creche_code" text,
	"company_id" text,
	"employee_id" text,
	"day" date NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "base"."payfit_absences" (
	"company_id" text NOT NULL,
	"payfit_absence_id" text NOT NULL,
	"contract_id" text NOT NULL,
	"type_code" text NOT NULL,
	"status" text NOT NULL,
	"start_date" date NOT NULL,
	"start_half" text NOT NULL,
	"end_date" date NOT NULL,
	"end_half" text NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payfit_absences_company_id_payfit_absence_id_pk" PRIMARY KEY("company_id","payfit_absence_id")
);
--> statement-breakpoint
CREATE TABLE "base"."payfit_companies" (
	"id" text PRIMARY KEY NOT NULL,
	"siret" text NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "base"."payfit_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" text NOT NULL,
	"payfit_contract_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date
);
--> statement-breakpoint
CREATE TABLE "base"."payfit_coverage" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"window_start" date NOT NULL,
	"window_end" date NOT NULL,
	"exhaustive" boolean NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "base"."payfit_employees" (
	"company_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	CONSTRAINT "payfit_employees_company_id_employee_id_pk" PRIMARY KEY("company_id","employee_id")
);
--> statement-breakpoint
CREATE TABLE "base"."source_anomalies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "base"."source_key" NOT NULL,
	"type" text NOT NULL,
	"label" text NOT NULL,
	"subject" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "base"."source_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_key" "base"."source_key" NOT NULL,
	"parent_id" uuid,
	"state" "base"."source_run_state" DEFAULT 'RUNNING' NOT NULL,
	"step" text,
	"volumes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_message" text,
	"started_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "base"."absence_events" ADD CONSTRAINT "absence_events_absence_id_absences_id_fk" FOREIGN KEY ("absence_id") REFERENCES "base"."absences"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."absences" ADD CONSTRAINT "absences_creche_code_creches_code_fk" FOREIGN KEY ("creche_code") REFERENCES "base"."creches"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."absences" ADD CONSTRAINT "absences_contract_id_payfit_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "base"."payfit_contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."absences" ADD CONSTRAINT "absences_type_code_absence_types_code_fk" FOREIGN KEY ("type_code") REFERENCES "base"."absence_types"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."absences" ADD CONSTRAINT "absences_declared_by_users_id_fk" FOREIGN KEY ("declared_by") REFERENCES "base"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."payfit_alerts" ADD CONSTRAINT "payfit_alerts_absence_id_absences_id_fk" FOREIGN KEY ("absence_id") REFERENCES "base"."absences"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."payfit_proofs" ADD CONSTRAINT "payfit_proofs_absence_id_absences_id_fk" FOREIGN KEY ("absence_id") REFERENCES "base"."absences"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."creche_assignments" ADD CONSTRAINT "creche_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "base"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."creche_assignments" ADD CONSTRAINT "creche_assignments_creche_code_creches_code_fk" FOREIGN KEY ("creche_code") REFERENCES "base"."creches"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."evp_accounts" ADD CONSTRAINT "evp_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "base"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."closures" ADD CONSTRAINT "closures_creche_code_creches_code_fk" FOREIGN KEY ("creche_code") REFERENCES "base"."creches"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."closures" ADD CONSTRAINT "closures_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "base"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."absence_pieces" ADD CONSTRAINT "absence_pieces_creche_code_creches_code_fk" FOREIGN KEY ("creche_code") REFERENCES "base"."creches"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."absence_pieces" ADD CONSTRAINT "absence_pieces_absence_id_absences_id_fk" FOREIGN KEY ("absence_id") REFERENCES "base"."absences"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."absence_pieces" ADD CONSTRAINT "absence_pieces_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "base"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."notification_reads" ADD CONSTRAINT "notification_reads_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "base"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."notification_reads" ADD CONSTRAINT "notification_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "base"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."notifications" ADD CONSTRAINT "notifications_absence_id_absences_id_fk" FOREIGN KEY ("absence_id") REFERENCES "base"."absences"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."payfit_absences" ADD CONSTRAINT "payfit_absences_company_id_payfit_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "base"."payfit_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."payfit_contracts" ADD CONSTRAINT "payfit_contracts_company_id_payfit_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "base"."payfit_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base"."payfit_employees" ADD CONSTRAINT "payfit_employees_company_id_payfit_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "base"."payfit_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "absence_events_absence_idx" ON "base"."absence_events" USING btree ("absence_id","at");--> statement-breakpoint
CREATE INDEX "absences_creche_status_idx" ON "base"."absences" USING btree ("creche_code","status");--> statement-breakpoint
CREATE INDEX "absences_contract_idx" ON "base"."absences" USING btree ("contract_id");--> statement-breakpoint
CREATE UNIQUE INDEX "absences_active_exact_unique" ON "base"."absences" USING btree ("contract_id","type_code","start_date","start_half","end_date","end_half") WHERE "base"."absences"."status" not in ('REJETEE', 'ANNULEE');--> statement-breakpoint
CREATE INDEX "payfit_alerts_absence_idx" ON "base"."payfit_alerts" USING btree ("absence_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payfit_alerts_one_open" ON "base"."payfit_alerts" USING btree ("absence_id") WHERE "base"."payfit_alerts"."resolved_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "payfit_proofs_absence_unique" ON "base"."payfit_proofs" USING btree ("absence_id");--> statement-breakpoint
CREATE INDEX "creches_siret_idx" ON "base"."creches" USING btree ("siret");--> statement-breakpoint
CREATE INDEX "absence_pieces_absence_idx" ON "base"."absence_pieces" USING btree ("absence_id");--> statement-breakpoint
CREATE INDEX "notifications_scope_created_idx" ON "base"."notifications" USING btree ("scope_code","created_at");--> statement-breakpoint
CREATE INDEX "aqoona_plannings_day_idx" ON "base"."aqoona_plannings" USING btree ("day");--> statement-breakpoint
CREATE INDEX "payfit_companies_siret_idx" ON "base"."payfit_companies" USING btree ("siret");--> statement-breakpoint
CREATE UNIQUE INDEX "payfit_contracts_company_contract_unique" ON "base"."payfit_contracts" USING btree ("company_id","payfit_contract_id");--> statement-breakpoint
CREATE INDEX "source_anomalies_source_idx" ON "base"."source_anomalies" USING btree ("source");--> statement-breakpoint
CREATE UNIQUE INDEX "source_runs_one_running" ON "base"."source_runs" USING btree ("source_key") WHERE "base"."source_runs"."state" = 'RUNNING';--> statement-breakpoint
CREATE INDEX "source_runs_source_started_idx" ON "base"."source_runs" USING btree ("source_key","started_at");