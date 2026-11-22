import "server-only";
import { fail } from "./brs-repository.ts";
import { groupScope, projectPair } from "./schedule-repository.ts";
import { effectiveSchedule, loadScheduleRecords, type EffectivePair } from "./schedule-effective.ts";
import { compareSlot, physicalAudience } from "./physical-education-schedule.ts";
import type { PhysicalDB, PhysicalGroup } from "./physical-education-access.ts";

export function isMakeup(pair: EffectivePair) {
  return "physicalMakeup" in pair.record && !!pair.record.physicalMakeup;
}

export function groupPairs(pairs: EffectivePair[], group: PhysicalGroup) {
  return pairs.filter(pair => pair.record.termId === group.plan.termId && pair.record.lesson.disciplineId === group.plan.disciplineId
    && pair.record.lesson.groups.some(link => link.groupId === group.plan.groupId));
}

export async function physicalPairs(db: PhysicalDB, group: PhysicalGroup) {
  return groupPairs(effectiveSchedule(await loadScheduleRecords(db), group.plan.term.startsOn, group.plan.term.endsOn, "personal"), group);
}

export function ended(pair: EffectivePair, now: Date) {
  return compareSlot(pair.date, pair.record.endMinute, pair.record.term.timeZone, now) <= 0;
}

export function started(pair: EffectivePair, now: Date) {
  return compareSlot(pair.date, pair.record.startMinute, pair.record.term.timeZone, now) <= 0;
}

function overlap(left: EffectivePair, right: EffectivePair) {
  return left.date.getTime() === right.date.getTime() && left.record.id !== right.record.id
    && left.record.startMinute < right.record.endMinute && right.record.startMinute < left.record.endMinute;
}

export function verifyResources(pairs: EffectivePair[], proposed: EffectivePair[]) {
  for (const slot of proposed) for (const other of pairs) {
    if (other.cancelled || !overlap(slot, other)) continue;
    if (slot.record.roomId === other.record.roomId) fail("Аудитория занята в выбранное время.", 409);
    if (slot.record.lesson.teachers.some(a => other.record.lesson.teachers.some(b => a.teacherId === b.teacherId))) fail("Преподаватель занят в выбранное время.", 409);
  }
}

export async function verifyStudentSchedule(db: PhysicalDB, studentId: string, normalGroup: string | undefined, pairs: EffectivePair[], proposed: EffectivePair[], ignoreGroup?: string) {
  const all = normalGroup ? await db.studyGroup.findMany({ select: { slug: true, parent: { select: { slug: true } } } }) : [];
  const academic = normalGroup ? groupScope(all.map(row => ({ slug: row.slug, parentSlug: row.parent?.slug ?? null })), normalGroup) : [];
  const audience = await physicalAudience(db, studentId);
  const own = pairs.filter(pair => !pair.cancelled && !pair.record.lesson.groups.some(link => link.groupId === ignoreGroup)
    && (audience.matchesPair(pair) || pair.record.lesson.groups.some(link => academic.includes(link.group.slug))));
  if (proposed.some(pair => own.some(other => overlap(pair, other)))) fail("Есть пересечение с расписанием студента.", 409);
}

export function lessonView(pair: EffectivePair) {
  return projectPair(pair, []);
}
