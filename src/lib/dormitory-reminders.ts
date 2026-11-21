import "server-only";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { emitNotification } from "./notifications-repository.ts";
import { chargeBalance } from "./dormitory-money.ts";
import { dormCalendarDay } from "./dormitory-state.ts";

export async function emitDormitoryPaymentReminders(db: PrismaClient, days: number, now = new Date()) {
  if (!Number.isInteger(days) || days < 0 || days > 30) throw new Error("DORMITORY_PAYMENT_REMINDER_DAYS must be an integer between 0 and 30.");
  const today = dormCalendarDay(now);
  const through = new Date(today.getTime() + days * 86400000);
  let previous: string | undefined;
  let emitted = 0;
  for (;;) {
    const candidates: { id: string }[] = await db.dormCharge.findMany({
      where: { dueOn: { lte: through }, student: { role: "STUDENT" }, ...(previous ? { id: { gt: previous } } : {}) },
      orderBy: { id: "asc" }, select: { id: true }, take: 100,
    });
    if (!candidates.length) return emitted;
    previous = candidates.at(-1)!.id;
    for (const candidate of candidates) {
      emitted += await db.$transaction(async tx => {
        await tx.dormWriteState.upsert({ where: { id: "dormitory" }, create: { id: "dormitory", version: 1 }, update: { version: { increment: 1 } } });
        const charge = await tx.dormCharge.findFirst({ where: { id: candidate.id, student: { role: "STUDENT" } }, include: { entries: true } });
        if (!charge || chargeBalance(charge) <= BigInt(0)) return 0;
        const overdue = charge.dueOn < today;
        const type = overdue ? "PAYMENT_OVERDUE" : "PAYMENT_DUE_SOON";
        const sourceKey = `dorm:charge:${charge.id}:${type}`;
        if (await tx.notificationEvent.count({ where: { sourceKey } })) return 0;
        await emitNotification(tx, {
          sourceKey, source: "DORMITORY", sourceId: charge.id, type, category: "DORMITORY",
          title: overdue ? "Просрочена оплата проживания" : "Приближается срок оплаты проживания",
          body: "Срок и остаток доступны в разделе «Оплата проживания».", mandatory: false, createdAt: now,
          recipients: [{ id: charge.studentId, role: "STUDENT", href: "/dashboard/dormitory#payments" }],
        });
        return 1;
      });
    }
  }
}
