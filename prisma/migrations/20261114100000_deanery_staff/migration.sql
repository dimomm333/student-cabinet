-- SQLite stores Role as TEXT, so adding the enum value requires no User rebuild.
-- Existing accounts, sessions, groups and timetable rows are untouched.
CREATE TABLE "DeaneryStaffProfile" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "position" TEXT,
  CONSTRAINT "DeaneryStaffProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "DeaneryDepartmentAssignment" (
  "userId" TEXT NOT NULL,
  "departmentId" TEXT NOT NULL,
  PRIMARY KEY ("userId", "departmentId"),
  CONSTRAINT "DeaneryDepartmentAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "DeaneryStaffProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DeaneryDepartmentAssignment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "AcademicDepartment"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "DeaneryDepartmentAssignment_departmentId_idx" ON "DeaneryDepartmentAssignment"("departmentId");
