ALTER TABLE "base"."payfit_absences" ALTER COLUMN "start_half" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "base"."payfit_absences" ALTER COLUMN "end_half" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "base"."evp_accounts" ADD COLUMN "google_sub" text;--> statement-breakpoint
ALTER TABLE "base"."aqoona_mismatches" ADD COLUMN "address_label" text;--> statement-breakpoint
ALTER TABLE "base"."aqoona_plannings" ADD COLUMN "address_label" text;--> statement-breakpoint
ALTER TABLE "base"."payfit_absences" ADD COLUMN "start_moment" text;--> statement-breakpoint
ALTER TABLE "base"."payfit_absences" ADD COLUMN "end_moment" text;--> statement-breakpoint
ALTER TABLE "base"."payfit_companies" ADD COLUMN "key_fingerprint" text;--> statement-breakpoint
ALTER TABLE "base"."payfit_companies" ADD COLUMN "company_id_resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "base"."payfit_contracts" ADD COLUMN "status" text DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "base"."payfit_coverage" ADD COLUMN "company_id" text;--> statement-breakpoint
ALTER TABLE "base"."payfit_coverage" ADD COLUMN "reachable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "base"."source_runs" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "base"."source_runs" ADD COLUMN "partial" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "evp_accounts_google_sub_unique" ON "base"."evp_accounts" USING btree ("google_sub") WHERE "base"."evp_accounts"."google_sub" is not null;--> statement-breakpoint
ALTER TABLE "base"."evp_accounts" ADD CONSTRAINT "evp_accounts_google_sub_length" CHECK ("base"."evp_accounts"."google_sub" is null or char_length("base"."evp_accounts"."google_sub") between 1 and 255);--> statement-breakpoint
ALTER TABLE "base"."payfit_contracts" ADD CONSTRAINT "payfit_contracts_status_check" CHECK ("base"."payfit_contracts"."status" in ('ACTIVE', 'ARCHIVED', 'PENDING'));