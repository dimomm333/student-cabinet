PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
-- CreateTable
CREATE TABLE "StudyGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "programme" TEXT NOT NULL,
    "course" INTEGER NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Discipline" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Building" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "buildingId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Room_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AcademicTerm" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startsOn" DATETIME NOT NULL,
    "endsOn" DATETIME NOT NULL,
    "firstNumeratorMonday" DATETIME NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'Europe/Moscow',
    "isPublished" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "Lesson" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "disciplineId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Lesson_disciplineId_fkey" FOREIGN KEY ("disciplineId") REFERENCES "Discipline" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LessonGroup" (
    "lessonId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,

    PRIMARY KEY ("lessonId", "groupId"),
    CONSTRAINT "LessonGroup_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LessonGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "StudyGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LessonTeacher" (
    "lessonId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,

    PRIMARY KEY ("lessonId", "teacherId"),
    CONSTRAINT "LessonTeacher_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LessonTeacher_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "TeacherProfile" ("userId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScheduleEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lessonId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL CHECK ("dayOfWeek" BETWEEN 1 AND 7),
    "startMinute" INTEGER NOT NULL CHECK ("startMinute" BETWEEN 0 AND 1439),
    "endMinute" INTEGER NOT NULL CHECK ("endMinute" > "startMinute" AND "endMinute" <= 1440),
    "weekPattern" TEXT NOT NULL DEFAULT 'EVERY',
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScheduleEntry_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ScheduleEntry_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ScheduleEntry_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
CREATE TABLE "new_News" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "publishedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "category" TEXT NOT NULL DEFAULT 'Объявления',
    "isDemo" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_News" ("content", "id", "publishedAt", "title") SELECT "content", "id", "publishedAt", "title" FROM "News";
DROP TABLE "News";
ALTER TABLE "new_News" RENAME TO "News";
CREATE INDEX "News_publishedAt_idx" ON "News"("publishedAt");
CREATE TABLE "new_StudentProfile" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "studentNumber" TEXT,
    "institute" TEXT,
    "program" TEXT,
    "groupName" TEXT,
    "course" INTEGER,
    "studyMode" TEXT,
    "groupId" TEXT,
    CONSTRAINT "StudentProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StudentProfile_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "StudyGroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_StudentProfile" ("course", "groupName", "institute", "program", "studentNumber", "studyMode", "userId") SELECT "course", "groupName", "institute", "program", "studentNumber", "studyMode", "userId" FROM "StudentProfile";
DROP TABLE "StudentProfile";
ALTER TABLE "new_StudentProfile" RENAME TO "StudentProfile";
CREATE UNIQUE INDEX "StudentProfile_studentNumber_key" ON "StudentProfile"("studentNumber");
CREATE INDEX "StudentProfile_groupId_idx" ON "StudentProfile"("groupId");
CREATE TABLE "new_TeacherProfile" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "department" TEXT,
    "position" TEXT,
    "scheduleSlug" TEXT,
    "publicName" TEXT,
    "isSchedulePublic" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "TeacherProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_TeacherProfile" ("department", "position", "userId") SELECT "department", "position", "userId" FROM "TeacherProfile";
DROP TABLE "TeacherProfile";
ALTER TABLE "new_TeacherProfile" RENAME TO "TeacherProfile";
CREATE UNIQUE INDEX "TeacherProfile_scheduleSlug_key" ON "TeacherProfile"("scheduleSlug");

-- CreateIndex
CREATE UNIQUE INDEX "StudyGroup_slug_key" ON "StudyGroup"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "StudyGroup_code_key" ON "StudyGroup"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Discipline_code_key" ON "Discipline"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Building_code_key" ON "Building"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Room_buildingId_number_key" ON "Room"("buildingId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "AcademicTerm_code_key" ON "AcademicTerm"("code");

-- CreateIndex
CREATE INDEX "LessonGroup_groupId_idx" ON "LessonGroup"("groupId");

-- CreateIndex
CREATE INDEX "LessonTeacher_teacherId_idx" ON "LessonTeacher"("teacherId");

-- CreateIndex
CREATE INDEX "ScheduleEntry_termId_isPublished_dayOfWeek_startMinute_idx" ON "ScheduleEntry"("termId", "isPublished", "dayOfWeek", "startMinute");

-- CreateIndex
CREATE INDEX "ScheduleEntry_lessonId_idx" ON "ScheduleEntry"("lessonId");

-- CreateIndex
CREATE INDEX "ScheduleEntry_roomId_idx" ON "ScheduleEntry"("roomId");


COMMIT;
PRAGMA foreign_keys=ON;
