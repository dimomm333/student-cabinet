-- CreateTable
CREATE TABLE "PeHealth" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "creditConditions" TEXT NOT NULL DEFAULT '',
    "assignedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PeHealth_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile" ("userId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PeHealth_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PeDirection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "PeGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "directionId" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 30,
    "registrationOpen" BOOLEAN NOT NULL DEFAULT false,
    "registrationFrom" DATETIME NOT NULL,
    "registrationUntil" DATETIME NOT NULL,
    CONSTRAINT "PeGroup_planId_fkey" FOREIGN KEY ("planId") REFERENCES "BrsPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PeGroup_directionId_fkey" FOREIGN KEY ("directionId") REFERENCES "PeDirection" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PeGroupCategory" (
    "groupId" TEXT NOT NULL,
    "category" TEXT NOT NULL,

    PRIMARY KEY ("groupId", "category"),
    CONSTRAINT "PeGroupCategory_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "PeGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PeEnrollment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    CONSTRAINT "PeEnrollment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile" ("userId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PeEnrollment_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PeEnrollment_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "PeGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PeMembership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "enrollmentId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "startsAt" DATETIME,
    "endsAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PeMembership_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "PeEnrollment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PeMembership_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "PeGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PeMembership_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PeWork" (
    "eventId" TEXT NOT NULL PRIMARY KEY,
    "description" TEXT NOT NULL,
    "measurement" TEXT NOT NULL,
    "criteria" TEXT NOT NULL,
    CONSTRAINT "PeWork_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "BrsEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PeWorkCategory" (
    "eventId" TEXT NOT NULL,
    "category" TEXT NOT NULL,

    PRIMARY KEY ("eventId", "category"),
    CONSTRAINT "PeWorkCategory_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "PeWork" ("eventId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PeMakeup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "exceptionId" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "bookingUntil" DATETIME NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "PeMakeup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "PeGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PeMakeup_exceptionId_fkey" FOREIGN KEY ("exceptionId") REFERENCES "ScheduleException" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PeBooking" (
    "makeupId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "cancelledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("makeupId", "studentId"),
    CONSTRAINT "PeBooking_makeupId_fkey" FOREIGN KEY ("makeupId") REFERENCES "PeMakeup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PeBooking_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile" ("userId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PeHealth_studentId_assignedAt_idx" ON "PeHealth"("studentId", "assignedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PeDirection_name_key" ON "PeDirection"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PeGroup_planId_key" ON "PeGroup"("planId");

-- CreateIndex
CREATE INDEX "PeEnrollment_groupId_idx" ON "PeEnrollment"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "PeEnrollment_studentId_termId_key" ON "PeEnrollment"("studentId", "termId");

-- CreateIndex
CREATE INDEX "PeMembership_enrollmentId_endsAt_idx" ON "PeMembership"("enrollmentId", "endsAt");

-- CreateIndex
CREATE INDEX "PeMembership_groupId_idx" ON "PeMembership"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "PeMakeup_exceptionId_key" ON "PeMakeup"("exceptionId");

-- CreateIndex
CREATE INDEX "PeMakeup_groupId_idx" ON "PeMakeup"("groupId");

-- CreateIndex
CREATE INDEX "PeBooking_studentId_cancelledAt_idx" ON "PeBooking"("studentId", "cancelledAt");
