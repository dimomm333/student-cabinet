import "server-only";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { calculateStudent, planInclude } from "./brs-repository.ts";
import { officialState } from "./brs-rules.ts";

export async function reconcileOfficialFinals(db: PrismaClient) {
  return db.$transaction(async tx => {
    await tx.scheduleWriteState.upsert({ where: { id: "schedule" }, create: { id: "schedule" }, update: { revision: { increment: 0 } } });
    await tx.brsWriteState.upsert({ where: { id: "brs" }, create: { id: "brs" }, update: { revision: { increment: 0 } } });
    const marked: string[] = [];
    for (const final of await tx.brsFinal.findMany({ where: { needsReview: false } })) {
      const plan = await tx.brsPlan.findUniqueOrThrow({ where: { id: final.planId }, include: planInclude });
      const { calculation } = await calculateStudent(tx, plan, final.studentId);
      const state = officialState(final, calculation)!;
      if (state.valid) continue;
      const after = await tx.brsFinal.update({ where: { id: final.id }, data: { needsReview: true, version: { increment: 1 } } });
      await tx.brsPlan.update({ where: { id: plan.id }, data: { revision: { increment: 1 } } });
      await tx.brsAudit.create({ data: { actorId: final.authorId, planId: plan.id, objectId: final.studentId, action: "FINAL_CONSISTENCY_REVIEW", requestId: `final-review-v1-${final.id}-${final.version}`, commandHash: "final-consistency-review-v1", beforeJson: JSON.stringify(final), afterJson: JSON.stringify({ system: true, official: after, calculation, reason: state.reviewReason }), reason: `Автоматическая служебная проверка: ${state.reviewReason}. Снимок сохранён, требуется явный пересмотр.` } });
      marked.push(final.id);
    }
    return { markedForReview: marked.length, ids: marked };
  }, { timeout: 60000, maxWait: 15000 });
}
