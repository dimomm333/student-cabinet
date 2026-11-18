import { createPrismaClient } from '../src/lib/prisma-client.ts';
import { deliverNotificationEmails } from '../src/lib/notifications-email.ts';
const db = createPrismaClient();
try { console.info(JSON.stringify(await deliverNotificationEmails(db))); }
finally { await db.$disconnect(); }
