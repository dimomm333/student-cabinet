import "server-only";
import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { DeaneryAccessDenied, getDeaneryContext, deaneryGroupWhere, type DeaneryActor } from "./deanery-repository.ts";
import { DAY_MS, isoDate, parseCalendarDate, parseDateInput, minuteLabel } from "./schedule-calendar.ts";
import { effectiveSchedule, loadScheduleRecords, occursOn, pairInclude, isPublicPair, type EffectivePair } from "./schedule-effective.ts";
import { groupScope, projectPair } from "./schedule-repository.ts";
import { invalidateScheduleApiCache } from "./schedule-api-runtime.ts";

export class ScheduleEditError extends Error {}
function fail(message: string): never { throw new ScheduleEditError(message); }
export type ScheduleCommand = {
  operation: "CREATE" | "UPDATE" | "DELETE" | "REPLACE" | "CANCEL" | "EXTRA" | "RESTORE";
  entryId?: string; exceptionId?: string; version?: number; sourceDate?: string; date?: string;
  groupIds?: string[]; teacherIds?: string[]; disciplineId?: string; roomId?: string; termId?: string;
  dayOfWeek?: number; start?: string; end?: string; kind?: string; weekPattern?: string; isPublished?: boolean;
  confirmed?: boolean;
};
type Tx = Prisma.TransactionClient;
const commandKinds = ["CREATE", "UPDATE", "DELETE", "REPLACE", "CANCEL", "EXTRA", "RESTORE"];
const ids = (items: unknown, max: number) => Array.isArray(items) && items.length > 0 && items.length <= max && items.every(item => typeof item === "string" && item.length > 0 && item.length <= 128) ? [...new Set(items as string[])] : fail("Выберите участников занятия.");
function dateInput(value: string | undefined) { return value ? parseCalendarDate(value) ?? parseDateInput(value) ?? fail("Укажите существующую дату в формате ДД.ММ.ГГГГ.") : fail("Выберите дату занятия."); }
function minutes(value: string | undefined) {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return fail("Укажите время в формате ЧЧ:ММ.");
  const [hour, minute] = value.split(":").map(Number);
  if (minute > 59 || hour > 24 || hour === 24 && minute !== 0) return fail("Некорректное время занятия.");
  return hour * 60 + minute;
}
export function relatedGroups(groups: { id: string; parentId: string | null }[], left: string, right: string) {
  const ancestor = (child: string, parent: string) => {
    const seen = new Set<string>();
    let current: string | null | undefined = child;
    while (current && !seen.has(current)) { if (current === parent) return true; seen.add(current); current = groups.find(group => group.id === current)?.parentId; }
    return false;
  };
  return ancestor(left, right) || ancestor(right, left);
}
async function guardGroups(tx: Tx, actor: DeaneryActor, groupIds: string[]) {
  const context = await getDeaneryContext(tx, actor);
  const groups = await tx.studyGroup.findMany({ select: { id: true, departmentId: true, parentId: true }, take: 5001 });
  if (groups.length > 5000) fail("Справочник групп требует расширения серверной выборки.");
  const allowed = new Set(context.departments.map(department => department.id));
  if (!groupIds.length || groupIds.some(id => !groups.some(group => group.id === id))) fail("Занятие или группа недоступны.");
  // Parent lessons affect subgroups too. Never edit a joint/hierarchical lesson
  // whose actual participants include an unassigned department.
  const affected = groups.filter(group => groupIds.some(id => relatedGroups(groups, id, group.id)));
  if (affected.some(group => !group.departmentId || !allowed.has(group.departmentId))) fail("Изменение затрагивает группу вне ваших полномочий.");
  return affected.map(group => group.id);
}
function snapshot(record: unknown) {
  return JSON.stringify(record);
}
async function material(tx: Tx, actor: DeaneryActor, command: ScheduleCommand) {
  const groupIds = ids(command.groupIds, 20), teacherIds = ids(command.teacherIds, 10);
  const affected = await guardGroups(tx, actor, groupIds);
  const startMinute = minutes(command.start), endMinute = minutes(command.end);
  if (startMinute >= endMinute || startMinute >= 1440) fail("Окончание занятия должно быть позже начала.");
  if (!["LECTURE", "PRACTICE", "SEMINAR", "LAB"].includes(command.kind ?? "")) fail("Выберите тип занятия.");
  if (!["EVERY", "NUMERATOR", "DENOMINATOR"].includes(command.weekPattern ?? "EVERY")) fail("Выберите повторение занятия.");
  const [term, room, discipline, teachers] = await Promise.all([
    tx.academicTerm.findUnique({ where: { id: command.termId ?? "" } }), tx.room.findUnique({ where: { id: command.roomId ?? "" }, include: { building: true } }),
    tx.discipline.findUnique({ where: { id: command.disciplineId ?? "" } }), tx.teacherProfile.findMany({ where: { userId: { in: teacherIds }, user: { role: "TEACHER" } } }),
  ]);
  if (!term || !room || !discipline || teachers.length !== teacherIds.length) fail("Выбранные данные недоступны. Обновите страницу.");
  if (term.timeZone !== "Europe/Moscow") fail("Поддерживается учебный календарь с московским временем.");
  if (term.endsOn < term.startsOn || term.endsOn.getTime() - term.startsOn.getTime() > 730 * DAY_MS) fail("Учебный период должен быть не длиннее двух лет.");
  const lesson = await tx.lesson.create({ data: { disciplineId: discipline.id, kind: command.kind as "LECTURE", groups: { create: groupIds.map(groupId => ({ groupId })) }, teachers: { create: teacherIds.map(teacherId => ({ teacherId })) } } });
  return { affected, groupIds, term, room, lesson, startMinute, endMinute };
}
function checkConflicts(records: Awaited<ReturnType<typeof loadScheduleRecords>>, groups: { id: string; parentId: string | null }[], from: Date, to: Date, affected: (pair: EffectivePair) => boolean) {
  const pairs = effectiveSchedule(records, from, to).filter(pair => !pair.cancelled);
  const candidates = pairs.filter(affected);
  for (const candidate of candidates) for (const other of pairs) {
    if (candidate === other || candidate.record.id === other.record.id || isoDate(candidate.date) !== isoDate(other.date)) continue;
    const a = candidate.record, b = other.record;
    if (a.startMinute >= b.endMinute || b.startMinute >= a.endMinute) continue;
    const date = isoDate(candidate.date);
    if (a.lesson.teachers.some(teacher => b.lesson.teachers.some(item => item.teacherId === teacher.teacherId))) fail(`Преподаватель занят в выбранное время (${date}). Выберите другое время или преподавателя.`);
    if (a.roomId === b.roomId) fail(`Аудитория занята в выбранное время (${date}).`);
    if (a.lesson.groups.some(group => b.lesson.groups.some(item => relatedGroups(groups, group.groupId, item.groupId)))) fail(`Есть пересечение занятий группы или подгруппы (${date}).`);
  }
}
export async function executeScheduleCommand(db: PrismaClient, actor: DeaneryActor, command: ScheduleCommand) {
  if (!commandKinds.includes(command.operation)) fail("Неизвестная операция.");
  if (["DELETE", "CANCEL", "RESTORE"].includes(command.operation) && !command.confirmed) fail("Подтвердите действие.");
  if (command.operation === "CREATE" && (command.entryId || command.exceptionId) || command.operation === "EXTRA" && command.entryId) fail("Некорректная операция.");
  if (["UPDATE", "DELETE"].includes(command.operation) && (!command.entryId || command.exceptionId)) fail("Выберите регулярную пару без идентификатора разового изменения.");
  try {
    const result = await db.$transaction(async tx => {
      // The first write locks the same DB row in every process. This serializes
      // conflict reads and writes across workers; no in-memory mutex is relied on.
      await tx.scheduleWriteState.upsert({ where: { id: "schedule" }, create: { id: "schedule", revision: 1 }, update: { revision: { increment: 1 } } });
      await getDeaneryContext(tx, actor);
      let entry = command.entryId ? await tx.scheduleEntry.findUnique({ where: { id: command.entryId }, include: pairInclude }) : null;
      let exception = command.exceptionId ? await tx.scheduleException.findUnique({ where: { id: command.exceptionId }, include: pairInclude }) : null;
      if (exception?.entryId && !entry) entry = await tx.scheduleEntry.findUnique({ where: { id: exception.entryId }, include: pairInclude });
      if (command.entryId && (!entry || entry.isDeleted) || command.exceptionId && (!exception || !exception.isActive)) fail("Занятие недоступно или уже изменено.");
      if (command.operation === "EXTRA" && exception?.entryId) fail("Для регулярной пары используйте разовую замену.");
      if (exception && command.entryId && exception.entryId !== command.entryId) fail("Занятие недоступно.");
      const affected: string[] = [];
      if (entry) affected.push(...await guardGroups(tx, actor, entry.lesson.groups.map(group => group.groupId)));
      if (exception) affected.push(...await guardGroups(tx, actor, exception.lesson.groups.map(group => group.groupId)));
      if (!["CREATE", "EXTRA"].includes(command.operation) || exception) {
        const version = entry?.version ?? exception?.version;
        if (!version || command.version !== version) fail("Расписание уже изменилось. Обновите страницу перед сохранением.");
      }
      let objectId = "", beforeJson: string | null = entry ? snapshot(entry) : exception ? snapshot(exception) : null;
      let from = entry?.term.startsOn, to = entry?.term.endsOn;
      if (command.operation === "CREATE" || command.operation === "UPDATE") {
        if (command.operation === "UPDATE" && !entry) fail("Выберите регулярное занятие.");
        if (entry && await tx.scheduleException.count({ where: { entryId: entry.id, isActive: true } })) fail("Сначала отмените разовые изменения этой пары, затем меняйте регулярное расписание.");
        if (!Number.isInteger(command.dayOfWeek) || command.dayOfWeek! < 1 || command.dayOfWeek! > 7) fail("Выберите день недели.");
        const data = await material(tx, actor, command); affected.push(...data.affected);
        const values = { lessonId: data.lesson.id, roomId: data.room.id, termId: data.term.id, startMinute: data.startMinute, endMinute: data.endMinute, dayOfWeek: command.dayOfWeek!, weekPattern: (command.weekPattern ?? "EVERY") as "EVERY", isPublished: command.isPublished === true };
        const saved = entry ? await tx.scheduleEntry.update({ where: { id: entry.id }, data: { ...values, version: { increment: 1 } }, include: pairInclude }) : await tx.scheduleEntry.create({ data: values, include: pairInclude });
        objectId = saved.id; entry = saved; from = saved.term.startsOn; to = saved.term.endsOn;
        if (!effectiveSchedule({ entries: [saved], exceptions: [] }, from, to).length) fail("В учебном периоде нет дат с выбранным днём и повторением.");
      } else if (command.operation === "DELETE") {
        if (!entry) fail("Выберите регулярное занятие.");
        const changes = await tx.scheduleException.findMany({ where: { entryId: entry.id, isActive: true }, include: pairInclude });
        for (const change of changes) affected.push(...await guardGroups(tx, actor, change.lesson.groups.map(group => group.groupId)));
        beforeJson = JSON.stringify({ entry, exceptions: changes });
        await tx.scheduleException.updateMany({ where: { entryId: entry.id }, data: { isActive: false, version: { increment: 1 } } });
        entry = await tx.scheduleEntry.update({ where: { id: entry.id }, data: { isDeleted: true, version: { increment: 1 } }, include: pairInclude }); objectId = entry.id;
      } else if (command.operation === "RESTORE") {
        if (!exception) fail("Выберите разовое изменение.");
        beforeJson = snapshot(exception); objectId = exception.id;
        exception = await tx.scheduleException.update({ where: { id: exception.id }, data: { isActive: false, version: { increment: 1 } }, include: pairInclude });
        if (entry) await tx.scheduleEntry.update({ where: { id: entry.id }, data: { version: { increment: 1 } } });
        from = exception.sourceDate; to = exception.sourceDate;
      } else {
        if (command.operation !== "EXTRA" && !entry) fail("Выберите регулярное занятие.");
        const sourceDate = command.operation === "EXTRA" ? dateInput(command.date) : dateInput(command.sourceDate);
        if (entry && !occursOn(entry, sourceDate)) fail("В исходную дату этой регулярной пары нет.");
        const existing = entry ? await tx.scheduleException.findUnique({ where: { entryId_sourceDate: { entryId: entry.id, sourceDate } }, include: pairInclude }) : exception;
        if (entry && exception && isoDate(exception.sourceDate) !== isoDate(sourceDate)) fail("Разовое изменение относится к другой исходной дате.");
        if (existing?.isActive && existing.id !== exception?.id) fail("На эту дату уже есть изменение. Обновите страницу.");
        if (existing) { affected.push(...await guardGroups(tx, actor, existing.lesson.groups.map(group => group.groupId))); beforeJson = snapshot(existing); }
        const cancelled = command.operation === "CANCEL";
        const cancelledRecord = existing ?? entry;
        const date = cancelled ? existing?.date ?? sourceDate : dateInput(command.date);
        const data = cancelled && cancelledRecord ? { lesson: cancelledRecord.lesson, room: cancelledRecord.room, term: cancelledRecord.term, startMinute: cancelledRecord.startMinute, endMinute: cancelledRecord.endMinute, affected: [] as string[], groupIds: cancelledRecord.lesson.groups.map(group => group.groupId) } : await material(tx, actor, command);
        if (entry && data.term.id !== entry.termId) fail("Разовое изменение должно оставаться в учебном периоде исходной пары.");
        if (entry && (data.groupIds.length !== entry.lesson.groups.length || data.groupIds.some(id => !entry!.lesson.groups.some(group => group.groupId === id)))) fail("Разовая замена должна сохранять состав учебных групп регулярной пары.");
        if (date < data.term.startsOn || date > data.term.endsOn) fail("Дата занятия должна входить в выбранный учебный период.");
        affected.push(...data.affected);
        const values = { entryId: entry?.id ?? null, sourceDate, date, lessonId: data.lesson.id, roomId: data.room.id, termId: data.term.id, startMinute: data.startMinute, endMinute: data.endMinute, isCancelled: cancelled, isPublished: cancelled ? cancelledRecord!.isPublished : command.isPublished === true, isActive: true };
        exception = existing ? await tx.scheduleException.update({ where: { id: existing.id }, data: { ...values, version: { increment: 1 } }, include: pairInclude }) : await tx.scheduleException.create({ data: values, include: pairInclude });
        objectId = exception.id;
        if (entry) await tx.scheduleEntry.update({ where: { id: entry.id }, data: { version: { increment: 1 } } });
        from = new Date(Math.min(sourceDate.getTime(), date.getTime())); to = new Date(Math.max(sourceDate.getTime(), date.getTime()));
      }
      if (!from || !to) fail("Некорректное изменение.");
      if (command.operation !== "DELETE") {
        const records = await loadScheduleRecords(tx);
        const groups = await tx.studyGroup.findMany({ select: { id: true, parentId: true } });
        checkConflicts(records, groups, from, to, pair => command.operation === "RESTORE" ? pair.entryId === entry?.id && isoDate(pair.date) === isoDate(from!) : pair.record.id === objectId);
      }
      const afterJson = exception ? snapshot(exception) : entry ? snapshot(entry) : null;
      await tx.scheduleAudit.create({ data: { actorId: actor.id, objectId, action: command.operation, beforeJson, afterJson, groups: { create: [...new Set(affected)].map(groupId => ({ groupId })) } } });
      const published = exception ? isPublicPair(exception) : entry && !entry.isDeleted ? isPublicPair(entry) : true;
      return { objectId, message: published ? "Изменения сохранены. Расписание обновлено." : "Сохранено. Публикация в открытом расписании ограничена настройками занятия, периода или участников." };
    }, { timeout: 20000, maxWait: 10000 });
    invalidateScheduleApiCache();
    return result;
  } catch (error) {
    if (error instanceof ScheduleEditError) throw error;
    if (error instanceof Error && "code" in error && ["P2034", "P1008", "P2028"].includes(String(error.code))) fail("Расписание меняется другим сотрудником. Обновите страницу и повторите сохранение.");
    throw error;
  }
}

export async function getScheduleEditor(db: PrismaClient, actor: DeaneryActor, selectedSlug: string, week: Date, day: number | null = null, requestedTerm = "") {
  const context = await getDeaneryContext(db, actor);
  const groups = await db.studyGroup.findMany({ where: deaneryGroupWhere(actor), select: { id: true, slug: true, code: true, parentId: true }, orderBy: { code: "asc" }, take: 501 });
  if (groups.length > 500) fail("Слишком много групп. Требуется расширить поиск.");
  const selected = selectedSlug ? groups.find(group => group.slug === selectedSlug) : groups[0];
  if (selectedSlug && !selected) throw new DeaneryAccessDenied();
  const records = await loadScheduleRecords(db);
  const scope = selected ? groupScope(groups.map(group => ({ slug: group.slug, parentSlug: groups.find(parent => parent.id === group.parentId)?.slug ?? null })), selected.slug) : [];
  const allIds = new Set(groups.map(group => group.id));
  const hierarchy = await db.studyGroup.findMany({ select: { id: true, parentId: true, departmentId: true }, take: 5001 });
  if (hierarchy.length > 5000) fail("Справочник групп требует расширения серверной выборки.");
  const assigned = new Set(context.departments.map(department => department.id));
  const relevant = (record: typeof records.entries[number] | typeof records.exceptions[number]) => record.lesson.groups.some(group => scope.includes(group.group.slug));
  const canEdit = (record: typeof records.entries[number] | typeof records.exceptions[number]) => record.lesson.groups.every(group => allIds.has(group.groupId)) && hierarchy.filter(group => record.lesson.groups.some(item => relatedGroups(hierarchy, item.groupId, group.id))).every(group => group.departmentId && assigned.has(group.departmentId));
  const [teachers, disciplines, rooms, terms, audits] = await Promise.all([
    db.teacherProfile.findMany({ where: { user: { role: "TEACHER" } }, select: { userId: true, publicName: true, isSchedulePublic: true, user: { select: { name: true } } }, orderBy: { user: { name: "asc" } }, take: 2001 }),
    db.discipline.findMany({ select: { id: true, title: true }, orderBy: { title: "asc" }, take: 2001 }),
    db.room.findMany({ select: { id: true, number: true, isPublic: true, building: { select: { name: true, isPublic: true } } }, orderBy: { number: "asc" }, take: 2001 }),
    db.academicTerm.findMany({ orderBy: { startsOn: "desc" } }),
    db.scheduleAudit.findMany({ where: { groups: { some: {}, every: { group: deaneryGroupWhere(actor) } } }, select: { id: true, createdAt: true, action: true, beforeJson: true, afterJson: true, actor: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  if (teachers.length > 2000 || disciplines.length > 2000 || rooms.length > 2000) fail("Справочник слишком большой. Требуется серверный поиск.");
  const formRecord = (record: typeof records.entries[number] | typeof records.exceptions[number]) => ({ id: record.id, version: record.version, groupIds: record.lesson.groups.map(group => group.groupId), teacherIds: record.lesson.teachers.map(teacher => teacher.teacherId), disciplineId: record.lesson.disciplineId, roomId: record.roomId, termId: record.termId, dayOfWeek: "dayOfWeek" in record ? record.dayOfWeek : (record.date.getUTCDay() + 6) % 7 + 1, start: minuteLabel(record.startMinute), end: minuteLabel(record.endMinute), kind: record.lesson.kind, weekPattern: "weekPattern" in record ? record.weekPattern : "EVERY", isPublished: record.isPublished });
  const visibleEntries = records.entries.filter(relevant);
  const activeTerms = terms.filter(term => term.startsOn <= new Date(week.getTime() + 6 * DAY_MS) && term.endsOn >= week);
  return {
    groups, selected: selected?.slug ?? "", selectedId: selected?.id ?? "", week: isoDate(week), day, termCode: activeTerms.find(term => term.code === requestedTerm)?.code ?? activeTerms[0]?.code ?? "", revision: (await db.scheduleWriteState.findUnique({ where: { id: "schedule" } }))?.revision ?? 0,
    teachers: teachers.map(teacher => ({ id: teacher.userId, name: teacher.publicName ?? teacher.user.name, public: teacher.isSchedulePublic })), disciplines,
    rooms: rooms.map(room => ({ id: room.id, name: `${room.building.name} · ауд. ${room.number}`, public: room.isPublic && room.building.isPublic })),
    terms: terms.map(term => ({ id: term.id, code: term.code, name: term.name, startsOn: isoDate(term.startsOn), endsOn: isoDate(term.endsOn), firstNumeratorMonday: isoDate(term.firstNumeratorMonday), published: term.isPublished })),
    entries: visibleEntries.map(entry => ({ ...formRecord(entry), editable: canEdit(entry), title: entry.lesson.discipline.title })),
    exceptions: records.exceptions.filter(relevant).map(exception => ({ ...formRecord(exception), entryId: exception.entryId, sourceDate: isoDate(exception.sourceDate), date: isoDate(exception.date), cancelled: exception.isCancelled, editable: canEdit(exception) })),
    occurrences: effectiveSchedule(records, week, new Date(week.getTime() + 6 * DAY_MS)).filter(pair => relevant(pair.record)).map(pair => ({
      lesson: { ...projectPair(pair), groups: projectPair(pair).groups.filter(group => groups.some(allowed => allowed.slug === group.slug)) }, entryId: pair.entryId, exceptionId: pair.exceptionId, sourceDate: isoDate(pair.sourceDate), editable: canEdit(pair.record), draft: !isPublicPair(pair.record),
    })),
    audits: audits.map(audit => ({ ...audit, createdAt: audit.createdAt.toISOString() })),
  };
}
export type ScheduleEditorModel = Awaited<ReturnType<typeof getScheduleEditor>>;
