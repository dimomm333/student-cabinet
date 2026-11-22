-- CreateTable
CREATE TABLE "UsefulEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parentId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "officialUrl" TEXT,
    "contacts" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "academicDepartmentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UsefulEntry_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "UsefulEntry" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UsefulEntry_academicDepartmentId_fkey" FOREIGN KEY ("academicDepartmentId") REFERENCES "AcademicDepartment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "UsefulEntry_parentId_sortOrder_idx" ON "UsefulEntry"("parentId", "sortOrder");

-- CreateIndex
CREATE INDEX "UsefulEntry_academicDepartmentId_idx" ON "UsefulEntry"("academicDepartmentId");
