CREATE TABLE "PassGrant" (
    "userId" TEXT NOT NULL PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "role" TEXT NOT NULL CHECK ("role" IN ('ADMIN','TECHNICAL_STAFF')),
    "canVerify" BOOLEAN NOT NULL DEFAULT false,
    "canManage" BOOLEAN NOT NULL DEFAULT false,
    "windowStart" DATETIME,
    "checks" INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE "StudentPass" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "studentId" TEXT NOT NULL REFERENCES "StudentProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE,
    "nonce" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "activeSlot" INTEGER DEFAULT 1,
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedBy" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "closedAt" DATETIME,
    "closedBy" TEXT REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "reason" TEXT,
    "requestId" TEXT REFERENCES "ServiceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK (("status" = 'ACTIVE' AND "activeSlot" IS 1 AND "closedAt" IS NULL AND "closedBy" IS NULL AND "reason" IS NULL)
        OR ("status" IN ('REPLACED','REVOKED') AND "activeSlot" IS NULL AND "closedAt" IS NOT NULL AND "closedBy" IS NOT NULL AND length(trim("reason")) > 0 AND "reason" IS NOT NULL))
);
CREATE UNIQUE INDEX "StudentPass_nonce_key" ON "StudentPass"("nonce");
CREATE UNIQUE INDEX "StudentPass_tokenHash_key" ON "StudentPass"("tokenHash");
CREATE UNIQUE INDEX "StudentPass_requestId_key" ON "StudentPass"("requestId");
CREATE UNIQUE INDEX "StudentPass_studentId_activeSlot_key" ON "StudentPass"("studentId","activeSlot");
CREATE INDEX "StudentPass_studentId_id_idx" ON "StudentPass"("studentId","id");
