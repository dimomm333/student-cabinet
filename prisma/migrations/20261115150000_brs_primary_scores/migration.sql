-- AlterTable
ALTER TABLE "BrsResult" ADD COLUMN "primaryMax" INTEGER;
ALTER TABLE "BrsResult" ADD COLUMN "primaryScore" INTEGER;
ALTER TABLE "BrsResult" ADD COLUMN "submissionTiming" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BrsEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "moduleId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "plannedOn" DATETIME,
    "issuedOn" DATETIME,
    "deadline" DATETIME,
    "maxScore" INTEGER NOT NULL,
    "primaryMax" INTEGER,
    "scaleVersion" INTEGER NOT NULL DEFAULT 1,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "labMinScore" INTEGER,
    "labRequiresDefense" BOOLEAN NOT NULL DEFAULT true,
    "occurrenceId" TEXT,
    CONSTRAINT "BrsEvent_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "BrsModule" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BrsEvent_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "BrsOccurrence" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_BrsEvent" ("deadline", "id", "issuedOn", "kind", "labMinScore", "labRequiresDefense", "maxScore", "moduleId", "number", "occurrenceId", "plannedOn", "required", "title", "week") SELECT "deadline", "id", "issuedOn", "kind", "labMinScore", "labRequiresDefense", "maxScore", "moduleId", "number", "occurrenceId", "plannedOn", "required", "title", "week" FROM "BrsEvent";
DROP TABLE "BrsEvent";
ALTER TABLE "new_BrsEvent" RENAME TO "BrsEvent";
CREATE INDEX "BrsEvent_moduleId_idx" ON "BrsEvent"("moduleId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
