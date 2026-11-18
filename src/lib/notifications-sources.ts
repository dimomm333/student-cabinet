import "server-only";
import type { Prisma } from "../generated/prisma/client.ts";
import { emitNotification } from "./notifications-repository.ts";
import { isoDate, mondayOf } from "./schedule-calendar.ts";
import type { loadScheduleRecords, EffectivePair } from "./schedule-effective.ts";
import { effectiveSchedule } from "./schedule-effective.ts";
import { groupScope } from "./schedule-repository.ts";

type Tx = Prisma.TransactionClient;
export type BrsNotificationState = { result?: unknown; final?: unknown; admission: string };
// Capture only student-visible semantics. Versions, author, private comments,
// scale settings and recalculation timestamps do not produce messages.
export function brsResultSignature(record: unknown): string | null {
  if (!record || typeof record !== "object") return null;
  const r = record as Record<string, unknown>;
  if (r.deleted) return null;
  if (r.score == null && r.passed == null && !r.labStatus && !r.performedOn && !r.defendedOn && !(r.commentVisible && r.comment)) return null;
  return JSON.stringify([r.id, r.score, r.primaryScore, r.primaryMax, r.exactNumerator, r.exactDenominator, r.passed, r.labStatus, r.submissionTiming,
    r.submittedOn, r.checkedOn, r.performedOn, r.defendedOn, r.heldOn, r.commentVisible ? r.comment : null]);
}
export async function emitBrsChanges(tx: Tx, input: { key: string; planId: string; studentId: string; eventId?: string; before: BrsNotificationState; after: BrsNotificationState }) {
  const user = await tx.user.findUnique({ where: { id: input.studentId }, select: { role: true } });
  if (user?.role !== "STUDENT") return;
  const href = `/dashboard/grades?planId=${encodeURIComponent(input.planId)}` + (input.eventId ? `&eventId=${encodeURIComponent(input.eventId)}#brs-event-${encodeURIComponent(input.eventId)}` : "");
  const recipients = [{ id: input.studentId, role: "STUDENT" as const, href }];
  const send = (type: string, title: string) => emitNotification(tx, { sourceKey: `brs:${input.key}:${input.studentId}:${type}`, source: "BRS", sourceId: input.planId, type, category: "STUDY", title, body: "В электронном журнале есть изменения. Откройте дисциплину для просмотра подробностей.", mandatory: true, recipients });
  if (input.before.result !== input.after.result) await send(input.before.result ? "RESULT_CORRECTED" : "RESULT_PUBLISHED", input.before.result ? "Результат работы изменён" : "Опубликован результат работы");
  if (input.before.final !== input.after.final) await send("FINAL_CHANGED", "Официальный итог обновлён");
  if (input.before.admission !== input.after.admission) await send("ADMISSION_CHANGED", "Изменился допуск к экзамену");
}
type Records = Awaited<ReturnType<typeof loadScheduleRecords>>;
function signature(pair: EffectivePair) {
  const r = pair.record;
  return JSON.stringify([isoDate(pair.date), r.startMinute, r.endMinute, r.roomId, r.lesson.disciplineId, r.lesson.kind, pair.cancelled,
    r.lesson.groups.map(g => g.groupId).sort(), r.lesson.teachers.map(t => t.teacherId).sort()]);
}
// Compare effective published occurrences, not IDs of newly allocated lessons.
// That suppresses no-op saves and includes both sides of a move/replacement.
export async function emitScheduleChanges(tx: Tx, key: string, before: Records, after: Records, from: Date, to: Date) {
  const groups = await tx.studyGroup.findMany({ select: { id: true, slug: true, parentId: true } });
  const hierarchy = groups.map(g => ({ slug: g.slug, parentSlug: groups.find(p => p.id === g.parentId)?.slug ?? null }));
  const visible = (records: Records) => effectiveSchedule(records, from, to, "personal");
  const old = visible(before), next = visible(after);
  const identity = (p: EffectivePair) => `${p.entryId ?? p.exceptionId}:${isoDate(p.sourceDate)}:${p.status === "MOVED_FROM" ? "from" : "pair"}`;
  const oldMap = new Map(old.map(p => [identity(p), p])), newMap = new Map(next.map(p => [identity(p), p]));
  const changed: EffectivePair[] = []; let changesPublished = false;
  for (const id of new Set([...oldMap.keys(), ...newMap.keys()])) {
    const a = oldMap.get(id), b = newMap.get(id);
    if ((!a || !b || signature(a) !== signature(b))) { if (a) { changed.push(a); changesPublished = true; } if (b) changed.push(b); }
  }
  if (!changed.length) return;
  const students = await tx.studentProfile.findMany({ where: { user: { role: "STUDENT" }, groupId: { not: null } }, select: { userId: true, groupId: true } });
  const recipients: { id: string; role: "STUDENT" | "TEACHER"; href: string; groupId?: string }[] = [];
  for (const student of students) {
    const group = groups.find(g => g.id === student.groupId); if (!group) continue;
    const scope = new Set(groupScope(hierarchy, group.slug));
    const relevant = changed.filter(p => p.record.lesson.groups.some(g => scope.has(g.group.slug)));
    if (relevant.length) {
      const date = relevant.map(p => p.date).sort((a,b) => a.getTime() - b.getTime())[0];
      recipients.push({ id: student.userId, role: "STUDENT", groupId: group.id, href: `/dashboard/schedule?week=${isoDate(mondayOf(date))}&day=${(date.getUTCDay() + 6) % 7 + 1}` });
    }
  }
  for (const id of new Set(changed.flatMap(p => p.record.lesson.teachers.map(t => t.teacherId)))) {
    const date = changed.filter(p => p.record.lesson.teachers.some(t => t.teacherId === id)).map(p => p.date).sort((a,b) => a.getTime() - b.getTime())[0];
    recipients.push({ id, role: "TEACHER", href: `/teacher/schedule?week=${isoDate(mondayOf(date))}&day=${(date.getUTCDay() + 6) % 7 + 1}` });
  }
  await emitNotification(tx, { sourceKey: `schedule:${key}`, source: "SCHEDULE", sourceId: key, type: changesPublished ? "SCHEDULE_CHANGED" : "SCHEDULE_PUBLISHED", category: "SCHEDULE", title: changesPublished ? "Изменилось расписание" : "Опубликовано расписание", body: "В вашем расписании есть изменения. Проверьте время, преподавателя и аудиторию.", mandatory: true, recipients });
}
