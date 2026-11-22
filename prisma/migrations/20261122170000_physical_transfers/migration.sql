-- CreateTable
CREATE TABLE "PeTransfer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "enrollmentId" TEXT NOT NULL,
    "fromGroupId" TEXT NOT NULL,
    "toGroupId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "active" BOOLEAN DEFAULT true,
    "comment" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" DATETIME,
    "decidedById" TEXT,
    CONSTRAINT "PeTransfer_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "PeEnrollment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PeTransfer_fromGroupId_fkey" FOREIGN KEY ("fromGroupId") REFERENCES "PeGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PeTransfer_toGroupId_fkey" FOREIGN KEY ("toGroupId") REFERENCES "PeGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PeTransfer_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PeTransfer_status_createdAt_idx" ON "PeTransfer"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PeTransfer_enrollmentId_active_key" ON "PeTransfer"("enrollmentId", "active");
