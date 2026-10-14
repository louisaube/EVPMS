ALTER TABLE "base"."absence_pieces" DROP CONSTRAINT "absence_pieces_absence_id_absences_id_fk";
--> statement-breakpoint
ALTER TABLE "base"."absence_pieces" ALTER COLUMN "absence_id" SET DATA TYPE text;