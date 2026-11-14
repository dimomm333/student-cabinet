ALTER TABLE "StudentProfile" ADD COLUMN "lastName" TEXT;
ALTER TABLE "StudentProfile" ADD COLUMN "firstName" TEXT;
ALTER TABLE "StudentProfile" ADD COLUMN "middleName" TEXT;
ALTER TABLE "StudentProfile" ADD COLUMN "gender" TEXT;
ALTER TABLE "StudentProfile" ADD COLUMN "citizenship" TEXT;
ALTER TABLE "StudentProfile" ADD COLUMN "contactPhone" TEXT;
ALTER TABLE "StudentProfile" ADD COLUMN "educationLevel" TEXT;
ALTER TABLE "StudentProfile" ADD COLUMN "fundingBasis" TEXT;
ALTER TABLE "StudentProfile" ADD COLUMN "enrolledAt" DATETIME;
ALTER TABLE "StudentProfile" ADD COLUMN "expectedGraduationYear" INTEGER;
ALTER TABLE "StudentProfile" ADD COLUMN "educationStatus" TEXT;
ALTER TABLE "StudentProfile" ADD COLUMN "personalFileNumber" TEXT;
ALTER TABLE "StudentProfile" ADD COLUMN "residenceStatus" TEXT;
ALTER TABLE "StudentProfile" ADD COLUMN "dormitory" TEXT;
ALTER TABLE "StudentProfile" ADD COLUMN "dormitoryRoom" TEXT;

CREATE TABLE "StudentOfficialPhoto" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "content" BLOB NOT NULL,
  "mimeType" TEXT NOT NULL,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentOfficialPhoto_userId_fkey" FOREIGN KEY ("userId") REFERENCES "StudentProfile" ("userId") ON DELETE CASCADE ON UPDATE CASCADE
);
