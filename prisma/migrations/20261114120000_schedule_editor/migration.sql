ALTER TABLE "ScheduleEntry" ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ScheduleEntry" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
CREATE TABLE "ScheduleException" (
  "id" TEXT NOT NULL PRIMARY KEY, "entryId" TEXT, "sourceDate" DATETIME NOT NULL, "date" DATETIME NOT NULL,
  "lessonId" TEXT NOT NULL, "termId" TEXT NOT NULL, "roomId" TEXT NOT NULL,
  "startMinute" INTEGER NOT NULL CHECK ("startMinute" >= 0 AND "startMinute" < 1440),
  "endMinute" INTEGER NOT NULL CHECK ("endMinute" > "startMinute" AND "endMinute" <= 1440),
  "isCancelled" BOOLEAN NOT NULL DEFAULT false, "isPublished" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true, "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
  FOREIGN KEY ("entryId") REFERENCES "ScheduleEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ScheduleException_entryId_sourceDate_key" ON "ScheduleException"("entryId", "sourceDate");
CREATE INDEX "ScheduleException_date_isActive_idx" ON "ScheduleException"("date", "isActive");
CREATE INDEX "ScheduleException_lessonId_idx" ON "ScheduleException"("lessonId");
CREATE INDEX "ScheduleException_termId_idx" ON "ScheduleException"("termId");
CREATE INDEX "ScheduleException_roomId_idx" ON "ScheduleException"("roomId");
CREATE TABLE "ScheduleWriteState" ("id" TEXT NOT NULL PRIMARY KEY, "revision" INTEGER NOT NULL DEFAULT 0);
INSERT INTO "ScheduleWriteState" ("id", "revision") VALUES ('schedule', 0);
CREATE TABLE "ScheduleAudit" (
  "id" TEXT NOT NULL PRIMARY KEY, "actorId" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "objectId" TEXT NOT NULL, "action" TEXT NOT NULL, "beforeJson" TEXT, "afterJson" TEXT,
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ScheduleAudit_createdAt_idx" ON "ScheduleAudit"("createdAt");
CREATE INDEX "ScheduleAudit_objectId_idx" ON "ScheduleAudit"("objectId");
CREATE TABLE "ScheduleAuditGroup" (
  "auditId" TEXT NOT NULL, "groupId" TEXT NOT NULL, PRIMARY KEY ("auditId", "groupId"),
  FOREIGN KEY ("auditId") REFERENCES "ScheduleAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("groupId") REFERENCES "StudyGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ScheduleAuditGroup_groupId_idx" ON "ScheduleAuditGroup"("groupId");
