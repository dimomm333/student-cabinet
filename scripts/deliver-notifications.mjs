import { createPrismaClient } from '../src/lib/prisma-client.ts';
import { deliverNotificationEmails } from '../src/lib/notifications-email.ts';
import { emitDormitoryPaymentReminders } from '../src/lib/dormitory-reminders.ts';
const db = createPrismaClient();
try {
  const configured = process.env.DORMITORY_PAYMENT_REMINDER_DAYS;
  const dormitoryReminders = configured ? await emitDormitoryPaymentReminders(db, Number(configured)) : 0;
  console.info(JSON.stringify({ ...await deliverNotificationEmails(db), dormitoryReminders }));
}
finally { await db.$disconnect(); }
