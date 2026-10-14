ALTER TYPE "base"."piece_status" ADD VALUE 'PURGED';--> statement-breakpoint
DROP INDEX "base"."source_runs_one_running";--> statement-breakpoint
ALTER TABLE "base"."source_runs" ALTER COLUMN "state" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "base"."source_runs" ALTER COLUMN "state" SET DEFAULT 'RUNNING'::text;--> statement-breakpoint
DROP TYPE "base"."source_run_state";--> statement-breakpoint
CREATE TYPE "base"."source_run_state" AS ENUM('RUNNING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
UPDATE "base"."source_runs" SET "state" = CASE "state" WHEN 'UP_TO_DATE' THEN 'SUCCEEDED' WHEN 'ERROR' THEN 'FAILED' ELSE "state" END;--> statement-breakpoint
ALTER TABLE "base"."source_runs" ALTER COLUMN "state" SET DEFAULT 'RUNNING'::"base"."source_run_state";--> statement-breakpoint
ALTER TABLE "base"."source_runs" ALTER COLUMN "state" SET DATA TYPE "base"."source_run_state" USING "state"::"base"."source_run_state";--> statement-breakpoint
CREATE UNIQUE INDEX "source_runs_one_running" ON "base"."source_runs" USING btree ("source_key") WHERE "base"."source_runs"."state" = 'RUNNING';--> statement-breakpoint
ALTER TABLE "base"."absence_pieces" ALTER COLUMN "size_bytes" SET DATA TYPE integer;
