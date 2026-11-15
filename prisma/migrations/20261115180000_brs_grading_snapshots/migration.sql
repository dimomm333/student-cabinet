-- Additive only: every existing score, raw input, version and audit row is preserved.
ALTER TABLE "BrsEvent" ADD COLUMN "scoringMode" TEXT NOT NULL DEFAULT 'RATING';
UPDATE "BrsEvent" SET "scoringMode" = 'PRIMARY' WHERE "primaryMax" IS NOT NULL;
ALTER TABLE "BrsResult" ADD COLUMN "scoreSource" TEXT NOT NULL DEFAULT 'HISTORICAL';
ALTER TABLE "BrsResult" ADD COLUMN "exactNumerator" TEXT;
ALTER TABLE "BrsResult" ADD COLUMN "exactDenominator" TEXT;
