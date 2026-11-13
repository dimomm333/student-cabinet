CREATE TABLE "AcademicDepartment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "faculty" TEXT NOT NULL,
  "name" TEXT NOT NULL
);
CREATE UNIQUE INDEX "AcademicDepartment_faculty_name_key" ON "AcademicDepartment"("faculty", "name");
ALTER TABLE "StudyGroup" ADD COLUMN "departmentId" TEXT REFERENCES "AcademicDepartment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StudyGroup" ADD COLUMN "parentId" TEXT REFERENCES "StudyGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "StudyGroup_departmentId_idx" ON "StudyGroup"("departmentId");
CREATE INDEX "StudyGroup_parentId_idx" ON "StudyGroup"("parentId");
