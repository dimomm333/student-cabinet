import "server-only";
import type { Prisma } from "../generated/prisma/client.ts";
import { effectiveSchedule, loadScheduleRecords } from "./schedule-effective.ts";
import { academicWeeks, isoDate, mondayOf, WEEK_MS } from "./schedule-calendar.ts";
import { relatedGroups } from "./schedule-editor-repository.ts";
import { distribute } from "./brs-rules.ts";

export async function brsSchedule(db: Prisma.TransactionClient, scope: { groupId: string; disciplineId: string; termId: string }) {
  const term = await db.academicTerm.findUniqueOrThrow({ where: { id: scope.termId } });
  const records = await loadScheduleRecords(db);
  const groups = await db.studyGroup.findMany({ select: { id: true, parentId: true }, take: 5001 });
  if (groups.length > 5000) throw new Error("Слишком много групп для текущей реализации календаря.");
  return effectiveSchedule(records, term.startsOn, term.endsOn, "personal").filter(pair => pair.status !== "MOVED_FROM" && pair.record.termId === scope.termId && pair.record.lesson.disciplineId === scope.disciplineId && pair.record.lesson.groups.some(group => relatedGroups(groups, scope.groupId, group.groupId))).map(pair => ({
    sourceKey: pair.entryId ? `entry:${pair.entryId}:${isoDate(pair.sourceDate)}` : `extra:${pair.exceptionId}`,
    date: isoDate(pair.date), week: Math.floor((mondayOf(pair.date).getTime() - mondayOf(term.startsOn).getTime()) / WEEK_MS) + 1,
    startMinute: pair.record.startMinute, endMinute: pair.record.endMinute, kind: pair.record.lesson.kind,
    cancelled: pair.cancelled, status: pair.status,
  }));
}
export type BrsSchedule = Awaited<ReturnType<typeof brsSchedule>>;
export async function syncOccurrences(db: Prisma.TransactionClient, planId: string, schedule: BrsSchedule) {
  for (const pair of schedule.filter(pair => !pair.cancelled)) {
    await db.brsOccurrence.upsert({ where: { planId_sourceKey: { planId, sourceKey: pair.sourceKey } },
      create: { planId, sourceKey: pair.sourceKey, date: new Date(pair.date), startMinute: pair.startMinute, endMinute: pair.endMinute, kind: pair.kind }, update: {} });
  }
}
export function moduleWeeks(startsOn: Date, endsOn: Date, count: number) {
  const weeks = academicWeeks(isoDate(startsOn), isoDate(endsOn));
  if (weeks.length < count * 3 || weeks.length > 110) throw new Error("В учебном периоде недостаточно недель для модулей либо период превышает два года.");
  let last = 0;
  return distribute(weeks.length, count).map(size => { const startWeek = last + 1; last += size; return { startWeek, endWeek: last }; });
}
