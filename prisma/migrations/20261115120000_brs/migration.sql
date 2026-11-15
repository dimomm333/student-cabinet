-- CreateTable
CREATE TABLE "TeachingAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teacherId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "disciplineId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "confirmedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "TeachingAssignment_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TeachingAssignment_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "StudyGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TeachingAssignment_disciplineId_fkey" FOREIGN KEY ("disciplineId") REFERENCES "Discipline" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TeachingAssignment_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BrsPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "disciplineId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "control" TEXT NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" DATETIME,
    "examOn" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BrsPlan_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "StudyGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BrsPlan_disciplineId_fkey" FOREIGN KEY ("disciplineId") REFERENCES "Discipline" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BrsPlan_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BrsModule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "startWeek" INTEGER NOT NULL,
    "endWeek" INTEGER NOT NULL,
    "seminarMax" INTEGER NOT NULL,
    "workMax" INTEGER NOT NULL,
    "controlMax" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PLANNED',
    "closedAt" DATETIME,
    CONSTRAINT "BrsModule_planId_fkey" FOREIGN KEY ("planId") REFERENCES "BrsPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BrsOccurrence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    CONSTRAINT "BrsOccurrence_planId_fkey" FOREIGN KEY ("planId") REFERENCES "BrsPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BrsEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "moduleId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "plannedOn" DATETIME,
    "issuedOn" DATETIME,
    "deadline" DATETIME,
    "maxScore" INTEGER NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "labMinScore" INTEGER,
    "labRequiresDefense" BOOLEAN NOT NULL DEFAULT true,
    "occurrenceId" TEXT,
    CONSTRAINT "BrsEvent_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "BrsModule" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BrsEvent_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "BrsOccurrence" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BrsResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "score" INTEGER,
    "passed" BOOLEAN,
    "labStatus" TEXT,
    "submittedOn" DATETIME,
    "checkedOn" DATETIME,
    "performedOn" DATETIME,
    "defendedOn" DATETIME,
    "comment" TEXT NOT NULL DEFAULT '',
    "commentVisible" BOOLEAN NOT NULL DEFAULT false,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BrsResult_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "BrsEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BrsResult_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BrsResult_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BrsAttendance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "occurrenceId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "mark" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "BrsAttendance_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "BrsOccurrence" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BrsAttendance_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BrsAttendance_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BrsAdmission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "approved" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "decidedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "basedRevision" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "BrsAdmission_planId_fkey" FOREIGN KEY ("planId") REFERENCES "BrsPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BrsAdmission_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BrsAdmission_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BrsExamAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "heldOn" DATETIME NOT NULL,
    "admissionVersion" INTEGER,
    "comment" TEXT NOT NULL DEFAULT '',
    "commentVisible" BOOLEAN NOT NULL DEFAULT false,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "BrsExamAttempt_planId_fkey" FOREIGN KEY ("planId") REFERENCES "BrsPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BrsExamAttempt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BrsExamAttempt_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BrsFinal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "rating" INTEGER NOT NULL,
    "grade" TEXT NOT NULL,
    "basisJson" TEXT NOT NULL,
    "basedRevision" INTEGER NOT NULL,
    "approvedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "BrsFinal_planId_fkey" FOREIGN KEY ("planId") REFERENCES "BrsPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BrsFinal_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BrsFinal_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BrsAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorId" TEXT NOT NULL,
    "planId" TEXT,
    "objectId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "commandHash" TEXT NOT NULL,
    "beforeJson" TEXT,
    "afterJson" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BrsAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BrsWriteState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "revision" INTEGER NOT NULL DEFAULT 0
);

-- CreateIndex
CREATE INDEX "TeachingAssignment_groupId_termId_idx" ON "TeachingAssignment"("groupId", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "TeachingAssignment_teacherId_groupId_disciplineId_termId_key" ON "TeachingAssignment"("teacherId", "groupId", "disciplineId", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "BrsPlan_groupId_disciplineId_termId_key" ON "BrsPlan"("groupId", "disciplineId", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "BrsModule_planId_number_key" ON "BrsModule"("planId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "BrsOccurrence_planId_sourceKey_key" ON "BrsOccurrence"("planId", "sourceKey");

-- CreateIndex
CREATE INDEX "BrsEvent_moduleId_idx" ON "BrsEvent"("moduleId");

-- CreateIndex
CREATE INDEX "BrsResult_studentId_idx" ON "BrsResult"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "BrsResult_eventId_studentId_key" ON "BrsResult"("eventId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "BrsAttendance_occurrenceId_studentId_key" ON "BrsAttendance"("occurrenceId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "BrsAdmission_planId_studentId_key" ON "BrsAdmission"("planId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "BrsExamAttempt_planId_studentId_number_key" ON "BrsExamAttempt"("planId", "studentId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "BrsFinal_planId_studentId_key" ON "BrsFinal"("planId", "studentId");

-- CreateIndex
CREATE INDEX "BrsAudit_planId_createdAt_idx" ON "BrsAudit"("planId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BrsAudit_actorId_requestId_key" ON "BrsAudit"("actorId", "requestId");
