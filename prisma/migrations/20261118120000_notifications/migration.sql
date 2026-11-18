-- Additive migration. Existing service events enter the same inbox once.
ALTER TABLE "News" ADD COLUMN "departmentId" TEXT;
ALTER TABLE "News" ADD COLUMN "publicationKey" TEXT;
CREATE UNIQUE INDEX "News_publicationKey_key" ON "News"("publicationKey");

CREATE TABLE "NotificationEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "mandatory" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Notification" (
    "seq" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "eventId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "recipientRole" TEXT NOT NULL,
    "scopeGroupId" TEXT,
    "scopeDepartmentId" TEXT,
    "href" TEXT NOT NULL,
    "readAt" DATETIME,
    CONSTRAINT "Notification_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "NotificationEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "NotificationSettings" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "optionalCategoriesJson" TEXT NOT NULL DEFAULT '["STUDY","SCHEDULE","SERVICES","ANNOUNCEMENTS","SYSTEM","MATERIALS","DORMITORY"]',
    "emailCategoriesJson" TEXT NOT NULL DEFAULT '[]',
    "personalEmail" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NotificationSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "NotificationEmail" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "notificationSeq" INTEGER NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'PERSONAL_EMAIL',
    "state" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseUntil" DATETIME,
    "sentAt" DATETIME,
    "lastError" TEXT,
    CONSTRAINT "NotificationEmail_notificationSeq_fkey" FOREIGN KEY ("notificationSeq") REFERENCES "Notification" ("seq") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "NotificationAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "boundary" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "NotificationWriteState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "version" INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX "NotificationEvent_sourceKey_key" ON "NotificationEvent"("sourceKey");

CREATE INDEX "Notification_recipientId_recipientRole_readAt_seq_idx" ON "Notification"("recipientId", "recipientRole", "readAt", "seq");

CREATE UNIQUE INDEX "Notification_eventId_recipientId_key" ON "Notification"("eventId", "recipientId");

CREATE INDEX "NotificationEmail_state_nextAttemptAt_idx" ON "NotificationEmail"("state", "nextAttemptAt");

CREATE UNIQUE INDEX "NotificationEmail_notificationSeq_channel_key" ON "NotificationEmail"("notificationSeq", "channel");

INSERT INTO "NotificationEvent" ("id", "sourceKey", "source", "sourceId", "type", "category", "title", "body", "mandatory", "createdAt")
SELECT 'service:' || "id", 'service:' || "id", 'SERVICES', "requestId", "type", 'SERVICES',
CASE "type"
WHEN 'SUBMITTED' THEN 'Заявление принято' WHEN 'RESUBMITTED' THEN 'Уточнение отправлено'
WHEN 'IN_REVIEW' THEN 'Заявление на рассмотрении' WHEN 'CLARIFICATION_REQUIRED' THEN 'Требуется уточнение заявления'
WHEN 'IN_PROGRESS' THEN 'Заявление в работе' WHEN 'COMPLETED' THEN 'Заявление исполнено'
WHEN 'REJECTED' THEN 'По заявлению получен отказ' WHEN 'STAFF_REPLY' THEN 'Поступил ответ сотрудника'
ELSE 'Заявление обновлено' END,
'Статус заявления изменился. Подробности доступны в личной карточке.', true, "createdAt" FROM "ServiceEvent";

-- No historical email queue. Existing service events were already displayed;
-- migrate as read so they are not presented as new user events.
INSERT INTO "Notification" ("eventId", "recipientId", "recipientRole", "href", "readAt")
SELECT 'service:' || "id", "recipientId", 'STUDENT', '/dashboard/services?requestId=' || "requestId", CURRENT_TIMESTAMP
FROM "ServiceEvent" ORDER BY "createdAt" ASC, "id" ASC;
