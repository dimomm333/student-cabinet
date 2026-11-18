-- CreateTable
CREATE TABLE "MaterialFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "LearningMaterial" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "disciplineId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "folderId" TEXT,
    "title" TEXT NOT NULL,
    "searchTitle" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "url" TEXT,
    "fileId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" DATETIME,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LearningMaterial_disciplineId_fkey" FOREIGN KEY ("disciplineId") REFERENCES "Discipline" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LearningMaterial_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LearningMaterial_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LearningMaterial_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "MaterialFolder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LearningMaterial_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "MaterialFile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MaterialTarget" (
    "materialId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,

    PRIMARY KEY ("materialId", "groupId"),
    CONSTRAINT "MaterialTarget_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "LearningMaterial" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MaterialTarget_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "StudyGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MaterialFolder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "authorId" TEXT NOT NULL,
    "disciplineId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "MaterialFolder_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MaterialFolder_disciplineId_fkey" FOREIGN KEY ("disciplineId") REFERENCES "Discipline" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MaterialFolder_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MaterialFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "MaterialFolder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MaterialPublication" (
    "id" TEXT NOT NULL PRIMARY KEY
);

-- CreateTable
CREATE TABLE "MaterialPublicationItem" (
    "publicationId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,

    PRIMARY KEY ("publicationId", "materialId"),
    CONSTRAINT "MaterialPublicationItem_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "MaterialPublication" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MaterialPublicationItem_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "LearningMaterial" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MaterialReceipt" (
    "actorId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "resultJson" TEXT NOT NULL,

    PRIMARY KEY ("actorId", "key"),
    CONSTRAINT "MaterialReceipt_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MaterialAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MaterialAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MaterialWriteState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "version" INTEGER NOT NULL DEFAULT 0
);

-- CreateIndex
CREATE UNIQUE INDEX "MaterialFile_key_key" ON "MaterialFile"("key");

-- CreateIndex
CREATE INDEX "LearningMaterial_termId_disciplineId_status_deletedAt_idx" ON "LearningMaterial"("termId", "disciplineId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "LearningMaterial_authorId_folderId_idx" ON "LearningMaterial"("authorId", "folderId");

-- CreateIndex
CREATE INDEX "MaterialTarget_groupId_idx" ON "MaterialTarget"("groupId");

-- CreateIndex
CREATE INDEX "MaterialFolder_authorId_termId_disciplineId_category_idx" ON "MaterialFolder"("authorId", "termId", "disciplineId", "category");

-- CreateIndex
CREATE INDEX "MaterialAudit_objectId_createdAt_idx" ON "MaterialAudit"("objectId", "createdAt");
CREATE INDEX "MaterialPublicationItem_materialId_idx" ON "MaterialPublicationItem"("materialId");
