CREATE TABLE "Consultation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teacherId" TEXT NOT NULL,
    "disciplineId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "cancelledAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Consultation_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "TeacherProfile" ("userId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Consultation_disciplineId_fkey" FOREIGN KEY ("disciplineId") REFERENCES "Discipline" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Consultation_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Consultation_minutes_check" CHECK ("startMinute" >= 0 AND "endMinute" <= 1440 AND "startMinute" < "endMinute")
);

CREATE TABLE "ConsultationGroup" (
    "consultationId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    PRIMARY KEY ("consultationId", "groupId"),
    CONSTRAINT "ConsultationGroup_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ConsultationGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "StudyGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "Consultation_teacherId_date_idx" ON "Consultation"("teacherId", "date");
CREATE INDEX "Consultation_roomId_date_idx" ON "Consultation"("roomId", "date");
CREATE INDEX "ConsultationGroup_groupId_idx" ON "ConsultationGroup"("groupId");
