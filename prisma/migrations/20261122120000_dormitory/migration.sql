-- CreateTable
CREATE TABLE "Dormitory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "contacts" TEXT,
    "archivedAt" DATETIME,
    "paymentUrl" TEXT
);

-- CreateTable
CREATE TABLE "DormBuilding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dormitoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "DormBuilding_dormitoryId_fkey" FOREIGN KEY ("dormitoryId") REFERENCES "Dormitory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DormFloor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "buildingId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    CONSTRAINT "DormFloor_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "DormBuilding" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DormBlock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "floorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "DormBlock_floorId_fkey" FOREIGN KEY ("floorId") REFERENCES "DormFloor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DormRoom" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "floorId" TEXT NOT NULL,
    "blockId" TEXT,
    "number" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" DATETIME,
    "notes" TEXT,
    CONSTRAINT "DormRoom_floorId_fkey" FOREIGN KEY ("floorId") REFERENCES "DormFloor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DormRoom_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "DormBlock" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DormBed" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" DATETIME,
    CONSTRAINT "DormBed_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "DormRoom" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DormGrant" (
    "dormitoryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY ("dormitoryId", "userId", "permission"),
    CONSTRAINT "DormGrant_dormitoryId_fkey" FOREIGN KEY ("dormitoryId") REFERENCES "Dormitory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DormGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DormPlacement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "bedId" TEXT NOT NULL,
    "serviceRequestId" TEXT,
    "previousId" TEXT,
    "status" TEXT NOT NULL,
    "reservedUntil" DATETIME NOT NULL,
    "startedAt" DATETIME,
    "endsOn" DATETIME,
    "endedAt" DATETIME,
    "basis" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DormPlacement_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DormPlacement_bedId_fkey" FOREIGN KEY ("bedId") REFERENCES "DormBed" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DormPlacement_serviceRequestId_fkey" FOREIGN KEY ("serviceRequestId") REFERENCES "ServiceRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DormPlacement_previousId_fkey" FOREIGN KEY ("previousId") REFERENCES "DormPlacement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DormRepair" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "dueOn" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 0,
    "mergedIntoId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DormRepair_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "DormRoom" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DormRepair_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DormRepair_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DormRepair_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "DormRepair" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DormRepairEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "repairId" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "staffOnly" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DormRepairEvent_repairId_fkey" FOREIGN KEY ("repairId") REFERENCES "DormRepair" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DormRepairEvent_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "DormAudit" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DormFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "repairId" TEXT,
    CONSTRAINT "DormFile_repairId_fkey" FOREIGN KEY ("repairId") REFERENCES "DormRepair" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DormDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dormitoryId" TEXT NOT NULL,
    "ownerId" TEXT,
    "placementId" TEXT,
    "fileId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DormDocument_dormitoryId_fkey" FOREIGN KEY ("dormitoryId") REFERENCES "Dormitory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DormDocument_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DormDocument_placementId_fkey" FOREIGN KEY ("placementId") REFERENCES "DormPlacement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DormDocument_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "DormFile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DormCharge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "placementId" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "periodFrom" DATETIME NOT NULL,
    "periodTo" DATETIME NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "dueOn" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DormCharge_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DormCharge_placementId_fkey" FOREIGN KEY ("placementId") REFERENCES "DormPlacement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DormLedgerEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chargeId" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DormLedgerEntry_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "DormCharge" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DormLedgerEntry_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "DormAudit" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DormAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "archivedAt" DATETIME,
    CONSTRAINT "DormAsset_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "DormRoom" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DormLoan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "placementId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isKey" BOOLEAN NOT NULL,
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returnedAt" DATETIME,
    "condition" TEXT,
    CONSTRAINT "DormLoan_placementId_fkey" FOREIGN KEY ("placementId") REFERENCES "DormPlacement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DormDeparture" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "placementId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "plannedOn" DATETIME NOT NULL,
    "inspectedAt" DATETIME,
    "notes" TEXT,
    "completedAt" DATETIME,
    CONSTRAINT "DormDeparture_placementId_fkey" FOREIGN KEY ("placementId") REFERENCES "DormPlacement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DormAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorId" TEXT,
    "requestKey" TEXT,
    "commandHash" TEXT,
    "action" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DormAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DormWriteState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "version" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "DormNewsTarget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "newsId" TEXT NOT NULL,
    "dormitoryId" TEXT NOT NULL,
    "buildingId" TEXT,
    CONSTRAINT "DormNewsTarget_newsId_fkey" FOREIGN KEY ("newsId") REFERENCES "News" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DormNewsTarget_dormitoryId_fkey" FOREIGN KEY ("dormitoryId") REFERENCES "Dormitory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DormNewsTarget_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "DormBuilding" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Extend the existing tables in place.
ALTER TABLE "News" ADD COLUMN "dormResidents" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "NotificationEvent" ADD COLUMN "dormRepairId" TEXT REFERENCES "DormRepair" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "NotificationEvent_dormRepairId_idx" ON "NotificationEvent"("dormRepairId");

-- CreateIndex
CREATE UNIQUE INDEX "Dormitory_name_key" ON "Dormitory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "DormBuilding_dormitoryId_name_key" ON "DormBuilding"("dormitoryId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "DormFloor_buildingId_number_key" ON "DormFloor"("buildingId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "DormBlock_floorId_name_key" ON "DormBlock"("floorId", "name");

-- CreateIndex
CREATE INDEX "DormRoom_blockId_idx" ON "DormRoom"("blockId");

-- CreateIndex
CREATE UNIQUE INDEX "DormRoom_floorId_number_key" ON "DormRoom"("floorId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "DormBed_roomId_number_key" ON "DormBed"("roomId", "number");

-- CreateIndex
CREATE INDEX "DormGrant_userId_active_idx" ON "DormGrant"("userId", "active");

-- CreateIndex
CREATE INDEX "DormPlacement_studentId_status_createdAt_idx" ON "DormPlacement"("studentId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "DormPlacement_bedId_status_reservedUntil_idx" ON "DormPlacement"("bedId", "status", "reservedUntil");

-- CreateIndex
CREATE INDEX "DormPlacement_status_reservedUntil_idx" ON "DormPlacement"("status", "reservedUntil");

-- CreateIndex
CREATE INDEX "DormPlacement_serviceRequestId_status_idx" ON "DormPlacement"("serviceRequestId", "status");

-- CreateIndex
CREATE INDEX "DormPlacement_previousId_idx" ON "DormPlacement"("previousId");

-- CreateIndex
CREATE INDEX "DormRepair_roomId_status_createdAt_idx" ON "DormRepair"("roomId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "DormRepair_assigneeId_status_idx" ON "DormRepair"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "DormRepair_mergedIntoId_idx" ON "DormRepair"("mergedIntoId");

-- CreateIndex
CREATE UNIQUE INDEX "DormRepairEvent_auditId_key" ON "DormRepairEvent"("auditId");

-- CreateIndex
CREATE INDEX "DormRepairEvent_repairId_createdAt_idx" ON "DormRepairEvent"("repairId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DormFile_key_key" ON "DormFile"("key");

-- CreateIndex
CREATE INDEX "DormFile_repairId_idx" ON "DormFile"("repairId");

-- CreateIndex
CREATE UNIQUE INDEX "DormDocument_fileId_key" ON "DormDocument"("fileId");

-- CreateIndex
CREATE INDEX "DormDocument_dormitoryId_ownerId_archivedAt_idx" ON "DormDocument"("dormitoryId", "ownerId", "archivedAt");

-- CreateIndex
CREATE INDEX "DormDocument_ownerId_archivedAt_idx" ON "DormDocument"("ownerId", "archivedAt");

-- CreateIndex
CREATE INDEX "DormDocument_placementId_kind_idx" ON "DormDocument"("placementId", "kind");

-- CreateIndex
CREATE INDEX "DormCharge_studentId_dueOn_idx" ON "DormCharge"("studentId", "dueOn");

-- CreateIndex
CREATE UNIQUE INDEX "DormCharge_placementId_periodFrom_periodTo_basis_key" ON "DormCharge"("placementId", "periodFrom", "periodTo", "basis");

-- CreateIndex
CREATE UNIQUE INDEX "DormLedgerEntry_auditId_key" ON "DormLedgerEntry"("auditId");

-- CreateIndex
CREATE UNIQUE INDEX "DormLedgerEntry_chargeId_kind_reference_key" ON "DormLedgerEntry"("chargeId", "kind", "reference");

-- CreateIndex
CREATE INDEX "DormAsset_roomId_archivedAt_idx" ON "DormAsset"("roomId", "archivedAt");

-- CreateIndex
CREATE INDEX "DormLoan_placementId_returnedAt_idx" ON "DormLoan"("placementId", "returnedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DormDeparture_placementId_key" ON "DormDeparture"("placementId");

-- CreateIndex
CREATE INDEX "DormAudit_targetId_createdAt_idx" ON "DormAudit"("targetId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DormAudit_actorId_requestKey_key" ON "DormAudit"("actorId", "requestKey");

-- CreateIndex
CREATE INDEX "DormNewsTarget_newsId_idx" ON "DormNewsTarget"("newsId");

-- CreateIndex
CREATE INDEX "DormNewsTarget_dormitoryId_buildingId_idx" ON "DormNewsTarget"("dormitoryId", "buildingId");

-- Current and historical placements share one table. SQLite partial indexes
-- enforce invariants even if a writer bypasses the application transaction.
CREATE UNIQUE INDEX "DormPlacement_live_bed" ON "DormPlacement"("bedId") WHERE "status" IN ('ACTIVE', 'RESERVED');
CREATE UNIQUE INDEX "DormPlacement_active_student" ON "DormPlacement"("studentId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "DormPlacement_reserved_student" ON "DormPlacement"("studentId") WHERE "status" = 'RESERVED';
CREATE UNIQUE INDEX "DormPlacement_consumed_decision" ON "DormPlacement"("serviceRequestId") WHERE "status" IN ('ACTIVE', 'ENDED');
CREATE UNIQUE INDEX "DormRepair_live_signature" ON "DormRepair"("roomId", "signature") WHERE "status" IN ('NEW', 'ACCEPTED', 'ASSIGNED', 'IN_PROGRESS', 'VERIFY', 'REWORK');
CREATE UNIQUE INDEX "DormDocument_live_contract" ON "DormDocument"("placementId") WHERE "kind" = 'CONTRACT' AND "archivedAt" IS NULL;
CREATE UNIQUE INDEX "DormNewsTarget_dorm_unique" ON "DormNewsTarget"("newsId", "dormitoryId") WHERE "buildingId" IS NULL;
CREATE UNIQUE INDEX "DormNewsTarget_building_unique" ON "DormNewsTarget"("newsId", "buildingId") WHERE "buildingId" IS NOT NULL;
