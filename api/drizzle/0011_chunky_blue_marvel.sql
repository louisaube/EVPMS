ALTER TABLE "base"."aqoona_plannings" ADD COLUMN "employee_company_id" text;--> statement-breakpoint
ALTER TABLE "base"."aqoona_plannings" ADD COLUMN "unlinked_cause" text;--> statement-breakpoint
ALTER TABLE "base"."aqoona_plannings" ADD COLUMN "creche_label" text;--> statement-breakpoint
-- v5 (rule-evp-link-one-establishment): before v5 a linked collaborator always belonged to the company of the crèche.
UPDATE "base"."aqoona_plannings" SET "employee_company_id" = "company_id" WHERE "employee_id" IS NOT NULL;--> statement-breakpoint
-- v5 (rule-evp-matching-rates-unknown-mode): the cause of an unlinked row written before v5 is unknown, so it is not told from a row without identity.
UPDATE "base"."aqoona_plannings" SET "match_method" = 'INCONNU' WHERE "match_method" = 'AUCUN';--> statement-breakpoint
ALTER TABLE "base"."aqoona_plannings" ADD CONSTRAINT "aqoona_plannings_unlinked_cause_check" CHECK ("base"."aqoona_plannings"."unlinked_cause" is null or "base"."aqoona_plannings"."unlinked_cause" in ('NIR_ABSENT', 'NIR_KEY_INVALID', 'NIR_UNKNOWN', 'NIR_AMBIGUOUS', 'PAYFIT_INCOMPLETE'));--> statement-breakpoint
ALTER TABLE "base"."aqoona_plannings" ADD CONSTRAINT "aqoona_plannings_employee_company_check" CHECK (("base"."aqoona_plannings"."employee_id" is null) = ("base"."aqoona_plannings"."employee_company_id" is null));
