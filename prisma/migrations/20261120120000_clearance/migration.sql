-- CreateTable
CREATE TABLE "ClearanceDepartment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1
);

-- CreateTable
CREATE TABLE "ClearanceGrant" (
    "userId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY ("userId", "departmentId"),
    CONSTRAINT "ClearanceGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ClearanceGrant_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "ClearanceDepartment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClearanceTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1
);

-- CreateTable
CREATE TABLE "ClearanceTemplateRule" (
    "templateId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "rule" TEXT NOT NULL,

    PRIMARY KEY ("templateId", "departmentId"),
    CONSTRAINT "ClearanceTemplateRule_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ClearanceTemplate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ClearanceTemplateRule_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "ClearanceDepartment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClearanceProcess" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "academicDepartmentId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateName" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "basisNote" TEXT NOT NULL,
    "orderNumber" TEXT,
    "orderDate" DATETIME,
    "startsOn" DATETIME NOT NULL,
    "plannedOn" DATETIME,
    "studentName" TEXT NOT NULL,
    "groupName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "activeKey" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "openedAt" DATETIME,
    "completedAt" DATETIME,
    "cancelledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "serviceRequestId" TEXT,
    CONSTRAINT "ClearanceProcess_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ClearanceProcess_academicDepartmentId_fkey" FOREIGN KEY ("academicDepartmentId") REFERENCES "AcademicDepartment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ClearanceProcess_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ClearanceTemplate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ClearanceProcess_serviceRequestId_fkey" FOREIGN KEY ("serviceRequestId") REFERENCES "ServiceRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClearanceStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "processId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "rule" TEXT NOT NULL,
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "needsClarification" BOOLEAN NOT NULL DEFAULT false,
    "applicabilityNote" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedByName" TEXT,
    "decidedAt" DATETIME,
    CONSTRAINT "ClearanceStep_processId_fkey" FOREIGN KEY ("processId") REFERENCES "ClearanceProcess" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ClearanceStep_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "ClearanceDepartment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClearanceRemark" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stepId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "requiredAction" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "dueOn" DATETIME,
    "amountMinor" INTEGER,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "resolvedAt" DATETIME,
    "responsePending" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClearanceRemark_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "ClearanceStep" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClearanceReply" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "remarkId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClearanceReply_remarkId_fkey" FOREIGN KEY ("remarkId") REFERENCES "ClearanceRemark" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClearanceHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "processId" TEXT,
    "stepId" TEXT,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "studentVisible" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClearanceHistory_processId_fkey" FOREIGN KEY ("processId") REFERENCES "ClearanceProcess" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ClearanceHistory_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "ClearanceStep" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClearanceDocument" (
    "processId" TEXT NOT NULL PRIMARY KEY,
    "snapshotJson" TEXT NOT NULL,
    "content" BLOB NOT NULL,
    "sha256" TEXT NOT NULL,
    "invalidatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClearanceDocument_processId_fkey" FOREIGN KEY ("processId") REFERENCES "ClearanceProcess" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClearanceReceipt" (
    "actorId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "processId" TEXT,
    "resultJson" TEXT NOT NULL,

    PRIMARY KEY ("actorId", "key"),
    CONSTRAINT "ClearanceReceipt_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClearanceWriteState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "version" INTEGER NOT NULL DEFAULT 0
);

-- CreateIndex
CREATE UNIQUE INDEX "ClearanceDepartment_code_key" ON "ClearanceDepartment"("code");

-- CreateIndex
CREATE INDEX "ClearanceGrant_departmentId_active_idx" ON "ClearanceGrant"("departmentId", "active");

-- CreateIndex
CREATE INDEX "ClearanceTemplate_reason_active_idx" ON "ClearanceTemplate"("reason", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ClearanceProcess_number_key" ON "ClearanceProcess"("number");

-- CreateIndex
CREATE UNIQUE INDEX "ClearanceProcess_activeKey_key" ON "ClearanceProcess"("activeKey");

-- CreateIndex
CREATE INDEX "ClearanceProcess_studentId_createdAt_id_idx" ON "ClearanceProcess"("studentId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ClearanceProcess_academicDepartmentId_status_createdAt_idx" ON "ClearanceProcess"("academicDepartmentId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ClearanceProcess_status_reason_createdAt_idx" ON "ClearanceProcess"("status", "reason", "createdAt");

-- CreateIndex
CREATE INDEX "ClearanceStep_departmentId_status_processId_idx" ON "ClearanceStep"("departmentId", "status", "processId");

-- CreateIndex
CREATE UNIQUE INDEX "ClearanceStep_processId_departmentId_key" ON "ClearanceStep"("processId", "departmentId");

-- CreateIndex
CREATE INDEX "ClearanceRemark_stepId_resolvedAt_idx" ON "ClearanceRemark"("stepId", "resolvedAt");

-- CreateIndex
CREATE INDEX "ClearanceReply_remarkId_createdAt_idx" ON "ClearanceReply"("remarkId", "createdAt");

-- CreateIndex
CREATE INDEX "ClearanceHistory_processId_createdAt_id_idx" ON "ClearanceHistory"("processId", "createdAt", "id");

-- Nullable source link: preserve all existing events and deliveries.
ALTER TABLE "NotificationEvent" ADD COLUMN "clearanceProcessId" TEXT REFERENCES "ClearanceProcess"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "NotificationEvent_clearanceProcessId_idx" ON "NotificationEvent"("clearanceProcessId");
