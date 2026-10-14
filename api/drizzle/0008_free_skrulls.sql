-- The coverage becomes one row per company (rule-evp-sources-partial-failure): the former single row (id = 1) is dropped
-- and recreated by the next PayFit reading.
DELETE FROM "base"."payfit_coverage";--> statement-breakpoint
ALTER TABLE "base"."payfit_coverage" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "base"."payfit_coverage" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "base"."payfit_coverage" ADD PRIMARY KEY ("company_id");
