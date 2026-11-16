-- CreateTable
CREATE TABLE "ServiceDefinition" (
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "configJson" TEXT NOT NULL,

    PRIMARY KEY ("code", "version")
);

-- CreateTable
CREATE TABLE "ServiceRoute" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serviceCode" TEXT NOT NULL,
    "sourceDepartmentId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "ServiceRoute_sourceDepartmentId_fkey" FOREIGN KEY ("sourceDepartmentId") REFERENCES "AcademicDepartment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ServiceRoute_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "AcademicDepartment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ServiceGrant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "serviceCode" TEXT,
    "category" TEXT,
    "readFiles" BOOLEAN NOT NULL DEFAULT false,
    "readMilitary" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "ServiceGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ServiceGrant_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "AcademicDepartment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ServiceRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "serviceCode" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "category" TEXT,
    "departmentId" TEXT,
    "assigneeId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "fieldsJson" TEXT NOT NULL DEFAULT '{}',
    "profileJson" TEXT,
    "confirmationHash" TEXT,
    "clarificationJson" TEXT,
    "resultText" TEXT,
    "completedBy" TEXT,
    "submittedAt" DATETIME,
    "completedAt" DATETIME,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ServiceRequest_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ServiceRequest_serviceCode_schemaVersion_fkey" FOREIGN KEY ("serviceCode", "schemaVersion") REFERENCES "ServiceDefinition" ("code", "version") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ServiceRequest_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "AcademicDepartment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ServiceRequest_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ServiceDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "removedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServiceDocument_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ServiceRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ServiceHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "text" TEXT,
    "snapshotJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServiceHistory_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ServiceRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ServiceEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recipientId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServiceEvent_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ServiceEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ServiceRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ServiceReceipt" (
    "actorId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "resultJson" TEXT NOT NULL,

    PRIMARY KEY ("actorId", "key"),
    CONSTRAINT "ServiceReceipt_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ServiceWriteState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "version" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "MilitaryRecord" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "departmentId" TEXT NOT NULL,
    "registrationStatus" TEXT,
    "office" TEXT,
    "documentType" TEXT,
    "documentNumber" TEXT,
    "verifiedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MilitaryRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MilitaryRecord_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "AcademicDepartment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceRoute_serviceCode_sourceDepartmentId_key" ON "ServiceRoute"("serviceCode", "sourceDepartmentId");

-- CreateIndex
CREATE INDEX "ServiceGrant_userId_departmentId_active_idx" ON "ServiceGrant"("userId", "departmentId", "active");

-- CreateIndex
CREATE INDEX "ServiceRequest_ownerId_deletedAt_createdAt_idx" ON "ServiceRequest"("ownerId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "ServiceRequest_departmentId_status_createdAt_idx" ON "ServiceRequest"("departmentId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ServiceRequest_assigneeId_status_idx" ON "ServiceRequest"("assigneeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceDocument_key_key" ON "ServiceDocument"("key");

-- CreateIndex
CREATE INDEX "ServiceDocument_requestId_removedAt_idx" ON "ServiceDocument"("requestId", "removedAt");

-- CreateIndex
CREATE INDEX "ServiceHistory_requestId_createdAt_id_idx" ON "ServiceHistory"("requestId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ServiceEvent_recipientId_createdAt_idx" ON "ServiceEvent"("recipientId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceEvent_requestId_version_type_key" ON "ServiceEvent"("requestId", "version", "type");
