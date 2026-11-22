-- CreateTable
CREATE TABLE "PortfolioAchievement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "achievedOn" DATETIME,
    "description" TEXT,
    "result" TEXT,
    "link" TEXT,
    "award" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'SELF_ADDED',
    "submittedAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PortfolioAchievement_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PortfolioAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "achievementId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PortfolioAttachment_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "PortfolioAchievement" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PortfolioDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "achievementId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "version" INTEGER NOT NULL,
    "verdict" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PortfolioDecision_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "PortfolioAchievement" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PortfolioDecision_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PortfolioAchievement_ownerId_achievedOn_idx" ON "PortfolioAchievement"("ownerId", "achievedOn");

-- CreateIndex
CREATE INDEX "PortfolioAchievement_ownerId_category_achievedOn_idx" ON "PortfolioAchievement"("ownerId", "category", "achievedOn");

-- CreateIndex
CREATE INDEX "PortfolioAchievement_status_submittedAt_idx" ON "PortfolioAchievement"("status", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioAttachment_storageKey_key" ON "PortfolioAttachment"("storageKey");

-- CreateIndex
CREATE INDEX "PortfolioAttachment_achievementId_createdAt_idx" ON "PortfolioAttachment"("achievementId", "createdAt");

-- CreateIndex
CREATE INDEX "PortfolioDecision_reviewerId_idx" ON "PortfolioDecision"("reviewerId");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioDecision_achievementId_version_key" ON "PortfolioDecision"("achievementId", "version");
