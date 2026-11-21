-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
BEGIN IMMEDIATE;
CREATE TABLE "new_DormCharge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "placementId" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "periodFrom" DATETIME NOT NULL,
    "periodTo" DATETIME NOT NULL,
    "amountRub" TEXT NOT NULL CHECK (
        length("amountRub") BETWEEN 4 AND 12 AND "amountRub" NOT GLOB '*[^0-9.-]*'
        AND "amountRub" = printf('%s%d.%02d',
            CASE WHEN CAST(replace("amountRub", '.', '') AS INTEGER) < 0 THEN '-' ELSE '' END,
            abs(CAST(replace("amountRub", '.', '') AS INTEGER)) / 100,
            abs(CAST(replace("amountRub", '.', '') AS INTEGER)) % 100)
    ),
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "dueOn" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DormCharge_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DormCharge_placementId_fkey" FOREIGN KEY ("placementId") REFERENCES "DormPlacement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_DormCharge" ("basis", "createdAt", "currency", "dueOn", "id", "periodFrom", "periodTo", "placementId", "studentId", "amountRub")
SELECT "basis", "createdAt", "currency", "dueOn", "id", "periodFrom", "periodTo", "placementId", "studentId",
    CASE WHEN typeof("amountMinor") = 'integer' THEN printf('%s%d.%02d', CASE WHEN "amountMinor" < 0 THEN '-' ELSE '' END, abs("amountMinor") / 100, abs("amountMinor") % 100) END
FROM "DormCharge";
DROP TABLE "DormCharge";
ALTER TABLE "new_DormCharge" RENAME TO "DormCharge";
CREATE INDEX "DormCharge_studentId_dueOn_idx" ON "DormCharge"("studentId", "dueOn");
CREATE UNIQUE INDEX "DormCharge_placementId_periodFrom_periodTo_basis_key" ON "DormCharge"("placementId", "periodFrom", "periodTo", "basis");
CREATE TABLE "new_DormLedgerEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chargeId" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amountRub" TEXT NOT NULL CHECK (
        length("amountRub") BETWEEN 4 AND 12 AND "amountRub" NOT GLOB '*[^0-9.-]*'
        AND "amountRub" = printf('%s%d.%02d',
            CASE WHEN CAST(replace("amountRub", '.', '') AS INTEGER) < 0 THEN '-' ELSE '' END,
            abs(CAST(replace("amountRub", '.', '') AS INTEGER)) / 100,
            abs(CAST(replace("amountRub", '.', '') AS INTEGER)) % 100)
    ),
    "reference" TEXT NOT NULL,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DormLedgerEntry_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "DormCharge" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DormLedgerEntry_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "DormAudit" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_DormLedgerEntry" ("auditId", "chargeId", "id", "kind", "recordedAt", "reference", "amountRub")
SELECT "auditId", "chargeId", "id", "kind", "recordedAt", "reference",
    CASE WHEN typeof("amountMinor") = 'integer' THEN printf('%s%d.%02d', CASE WHEN "amountMinor" < 0 THEN '-' ELSE '' END, abs("amountMinor") / 100, abs("amountMinor") % 100) END
FROM "DormLedgerEntry";
DROP TABLE "DormLedgerEntry";
ALTER TABLE "new_DormLedgerEntry" RENAME TO "DormLedgerEntry";
CREATE UNIQUE INDEX "DormLedgerEntry_auditId_key" ON "DormLedgerEntry"("auditId");
CREATE UNIQUE INDEX "DormLedgerEntry_chargeId_kind_reference_key" ON "DormLedgerEntry"("chargeId", "kind", "reference");
COMMIT;
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
