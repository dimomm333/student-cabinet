import "server-only";
import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { DAY_MS, isoDate, weekParity } from "./schedule-calendar.ts";

export const pairInclude = {
  term: true, room: { include: { building: true } }, lesson: { include: {
    discipline: true, groups: { include: { group: true } },
    teachers: { include: { teacher: { include: { user: { select: { id: true, name: true, role: true } } } } } },
  } },
} satisfies Prisma.ScheduleEntryInclude;
export type RegularPair = Prisma.ScheduleEntryGetPayload<{ include: typeof pairInclude }>;
export type ExceptionPair = Prisma.ScheduleExceptionGetPayload<{ include: typeof pairInclude }>;
export type ScheduleRecords = { entries: RegularPair[]; exceptions: ExceptionPair[] };
export type ScheduleDB = Pick<PrismaClient, "scheduleEntry" | "scheduleException">;
export type PairStatus = "REGULAR" | "REPLACED" | "MOVED" | "MOVED_FROM" | "CANCELLED" | "ADDED";
export type EffectivePair = {
  record: RegularPair | ExceptionPair; entryId: string | null; exceptionId: string | null;
  date: Date; sourceDate: Date; targetDate?: Date; status: PairStatus; cancelled: boolean; original?: RegularPair;
};
export async function loadScheduleRecords(db: ScheduleDB): Promise<ScheduleRecords> {
  const [entries, exceptions] = await Promise.all([
    db.scheduleEntry.findMany({ where: { isDeleted: false }, include: pairInclude, take: 10001 }),
    db.scheduleException.findMany({ where: { isActive: true }, include: pairInclude, take: 10001 }),
  ]);
  // Never silently omit records during conflict checks or effective reads.
  if (entries.length > 10000 || exceptions.length > 10000) throw new Error("Превышен объём расписания. Требуется расширение серверной выборки.");
  return { entries, exceptions };
}
export function occursOn(entry: RegularPair, date: Date) {
  return !entry.isDeleted && date >= entry.term.startsOn && date <= entry.term.endsOn
    && (date.getUTCDay() + 6) % 7 + 1 === entry.dayOfWeek
    && (entry.weekPattern === "EVERY" || entry.weekPattern === weekParity(date, entry.term.firstNumeratorMonday));
}
export function isPublicPair(record: RegularPair | ExceptionPair) {
  return record.isPublished && record.term.isPublished && record.room.isPublic && record.room.building.isPublic
    && record.lesson.groups.length > 0 && record.lesson.groups.every(item => item.group.isPublic)
    && record.lesson.teachers.length > 0 && record.lesson.teachers.every(item => item.teacher.isSchedulePublic && item.teacher.publicName && item.teacher.scheduleSlug && item.teacher.user.role === "TEACHER");
}
export function effectiveSchedule(records: ScheduleRecords, from: Date, to: Date, visibility: "public" | "personal" | "editor" = "editor") {
  const output: EffectivePair[] = [];
  const entries = new Map(records.entries.map(entry => [entry.id, entry]));
  const overrides = new Set(records.exceptions.filter(item => item.entryId).map(item => `${item.entryId}:${isoDate(item.sourceDate)}`));
  const visible = (record: RegularPair | ExceptionPair) => visibility === "editor" || (visibility === "public" ? isPublicPair(record) : record.isPublished && record.term.isPublished);
  for (const entry of records.entries) {
    if (!visible(entry)) continue;
    const first = new Date(Math.max(from.getTime(), entry.term.startsOn.getTime()));
    first.setUTCDate(first.getUTCDate() + (entry.dayOfWeek - ((first.getUTCDay() + 6) % 7 + 1) + 7) % 7);
    for (let date = first; date <= to && date <= entry.term.endsOn; date = new Date(date.getTime() + 7 * DAY_MS)) {
      if (occursOn(entry, date) && !overrides.has(`${entry.id}:${isoDate(date)}`)) output.push({ record: entry, entryId: entry.id, exceptionId: null, date, sourceDate: date, status: "REGULAR", cancelled: false });
    }
  }
  for (const exception of records.exceptions) {
    const original = exception.entryId ? entries.get(exception.entryId) : undefined;
    if (exception.entryId && (!original || !occursOn(original, exception.sourceDate))) continue;
    // Suppression above happens before publication filtering: a private change
    // must never make an obsolete public original reappear.
    if (!visible(exception)) continue;
    const moved = original && isoDate(exception.sourceDate) !== isoDate(exception.date);
    if (moved && visible(original) && exception.sourceDate >= from && exception.sourceDate <= to) {
      output.push({ record: original, entryId: original.id, exceptionId: exception.id, date: exception.sourceDate, sourceDate: exception.sourceDate, targetDate: exception.date, status: "MOVED_FROM", cancelled: true, original });
    }
    if (exception.date >= from && exception.date <= to && exception.date >= exception.term.startsOn && exception.date <= exception.term.endsOn) {
      output.push({ record: exception, entryId: exception.entryId, exceptionId: exception.id, date: exception.date, sourceDate: exception.sourceDate,
        status: exception.isCancelled ? "CANCELLED" : !original ? "ADDED" : moved ? "MOVED" : "REPLACED", cancelled: exception.isCancelled, original });
    }
  }
  return output.sort((a, b) => a.date.getTime() - b.date.getTime() || a.record.startMinute - b.record.startMinute || a.record.id.localeCompare(b.record.id));
}
