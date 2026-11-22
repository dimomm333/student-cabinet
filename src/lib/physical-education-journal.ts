import "server-only";
import { fail, type BrsActor } from "./brs-repository.ts";
import { parsePoints } from "./brs-rules.ts";
import { emitBrsChanges, brsResultSignature, emitScheduleChanges } from "./notifications-sources.ts";
import { latestHealth } from "./physical-education-brs.ts";
import { physicalLimits } from "./physical-education-rules.ts";
import { compareSlot, inMembership, occurrenceKey } from "./physical-education-schedule.ts";
import { currentAcademicDate, isoDate, mondayOf, WEEK_MS } from "./schedule-calendar.ts";
import { effectiveSchedule, loadScheduleRecords } from "./schedule-effective.ts";
import { administrative, studentFor, teacherAssignments, type PhysicalDB, type PhysicalGroup } from "./physical-education-access.ts";
import { ended, groupPairs, isMakeup, physicalPairs, started, verifyResources, verifyStudentSchedule } from "./physical-education-timetable.ts";
import type { PhysicalInput } from "./physical-education-input.ts";

function teacher(actor: BrsActor) {
  if (actor.role !== "TEACHER") fail("Действие доступно назначенному преподавателю.", 403);
}

export function registrationAvailable(group: PhysicalGroup, now: Date) {
  const today = currentAcademicDate(now, group.plan.term.timeZone);
  return group.plan.term.isPublished && group.registrationOpen && today >= group.registrationFrom && today <= group.registrationUntil;
}

export const makeupInclude = { exception: { include: { room: { include: { building: true } } } } } as const;

export async function createMakeup(tx: PhysicalDB, actor: BrsActor, group: PhysicalGroup, input: PhysicalInput, now: Date, requestId: string) {
  teacher(actor);
  const { term } = group.plan;
  const date = input.date("date"), bookingUntil = input.date("until");
  const time = input.time();
  if (date < term.startsOn || date > term.endsOn || bookingUntil > date || bookingUntil < currentAcademicDate(now, term.timeZone)
    || compareSlot(date, time.startMinute, term.timeZone, now) <= 0) fail("Укажите будущее занятие в семестре и срок записи до его начала.");
  const roomId = input.value("roomId");
  if (!await tx.room.count({ where: { id: roomId } })) fail("Выберите аудиторию.");
  const capacity = input.number("capacity", 1, 500);
  const comment = input.value("comment", 500, false);
  const before = await loadScheduleRecords(tx);
  const lesson = await tx.lesson.create({ data: { disciplineId: group.plan.disciplineId, kind: "PRACTICE",
    groups: { create: { groupId: group.plan.groupId } }, teachers: { create: { teacherId: actor.id } } } });
  const exception = await tx.scheduleException.create({ data: { sourceDate: date, date, roomId, ...time, termId: term.id, lessonId: lesson.id, isPublished: true } });
  const makeup = await tx.peMakeup.create({ data: { groupId: group.id, exceptionId: exception.id, capacity, bookingUntil, comment } });
  const after = await loadScheduleRecords(tx);
  const all = effectiveSchedule(after, date, date);
  verifyResources(all, all.filter(pair => pair.record.id === exception.id));
  await emitScheduleChanges(tx, requestId, before, after, date, date);
  return makeup.id;
}

export async function bookMakeup(tx: PhysicalDB, actor: BrsActor, group: PhysicalGroup, input: PhysicalInput, now: Date, cancel: boolean) {
  if (actor.role !== "STUDENT") fail("Запись доступна студенту.", 403);
  const student = await studentFor(tx, actor, actor.id);
  const { term } = group.plan;
  const makeup = await tx.peMakeup.findFirst({ where: { id: input.value("makeupId"), groupId: group.id }, include: makeupInclude });
  if (!makeup) fail("Отработка недоступна.", 404);
  const bookingKey = { makeupId: makeup.id, studentId: actor.id };
  const booking = await tx.peBooking.findUnique({ where: { makeupId_studentId: bookingKey } });
  const date = makeup.exception.date;
  const today = currentAcademicDate(now, term.timeZone);
  const slotStarted = compareSlot(date, makeup.exception.startMinute, term.timeZone, now) <= 0;
  if (cancel) {
    if (!booking || booking.cancelledAt) fail("Действующей записи нет.", 404);
    if (makeup.exception.isCancelled || slotStarted || today > makeup.bookingUntil) fail("Срок отмены записи истёк.");
    await tx.peBooking.update({ where: { makeupId_studentId: bookingKey }, data: { cancelledAt: now } });
    return makeup.id;
  }
  if (!term.isPublished || student.educationStatus && student.educationStatus !== "STUDYING"
    || student.group?.departmentId !== group.plan.group.departmentId
    || !await tx.peEnrollment.count({ where: { groupId: group.id, studentId: actor.id } })) fail("Отработка недоступна для вашей группы.", 403);
  if (!(await teacherAssignments(tx, [group])).length) fail("У группы нет действующего преподавателя.");
  const health = await latestHealth(tx, student.userId);
  if (!health || !group.categories.some(item => item.category === health.category)) fail("Отработка не соответствует назначенной группе здоровья.", 403);
  if (slotStarted || today > makeup.bookingUntil || makeup.exception.isCancelled || !makeup.exception.isPublished || !makeup.exception.isActive) fail("Запись на отработку закрыта.");
  if (booking && !booking.cancelledAt) return makeup.id;
  if (await tx.peBooking.count({ where: { makeupId: makeup.id, cancelledAt: null } }) >= makeup.capacity) fail("Нет свободных мест.", 409);
  const monday = mondayOf(date);
  if (await tx.peBooking.count({ where: { studentId: actor.id, cancelledAt: null, makeup: {
    exception: { isCancelled: false, isActive: true, date: { gte: monday, lt: new Date(+monday + WEEK_MS) } },
  } } }) >= physicalLimits.weeklyMakeups) fail("На эту неделю уже записаны две отработки.", 409);
  const all = effectiveSchedule(await loadScheduleRecords(tx), date, date, "personal");
  const proposed = all.filter(pair => pair.record.id === makeup.exception.id && !pair.cancelled);
  if (!proposed.length) fail("Отработка отсутствует в расписании.");
  await verifyStudentSchedule(tx, actor.id, student.group?.slug, all, proposed);
  await tx.peBooking.upsert({ where: { makeupId_studentId: bookingKey }, create: { ...bookingKey, createdAt: now }, update: { cancelledAt: null, createdAt: now } });
  return makeup.id;
}

export async function attendance(tx: PhysicalDB, actor: BrsActor, group: PhysicalGroup, input: PhysicalInput, now: Date, requestId: string) {
  teacher(actor);
  const source = input.value("slot");
  const slot = (await physicalPairs(tx, group)).find(pair => occurrenceKey(pair) === source && !pair.cancelled);
  if (!slot || !ended(slot, now)) fail("Можно отметить только проведённое занятие.");
  if (!slot.record.lesson.teachers.some(row => row.teacherId === actor.id)) fail("Занятие проводил другой преподаватель.", 403);
  const mark = input.value("mark");
  if (!["PRESENT", "ABSENT", "EXCUSED"].includes(mark)) fail("Выберите отметку посещаемости.");
  const selected = input.values("students");
  if (!selected.length) fail("Выберите студентов в журнале.");
  const makeup = isMakeup(slot);
  const eligible = makeup
    ? (await tx.peBooking.findMany({ where: { makeup: { exceptionId: slot.record.id }, cancelledAt: null, studentId: { in: selected }, student: { user: { role: "STUDENT" } } }, select: { studentId: true } })).map(row => row.studentId)
    : (await tx.peMembership.findMany({ where: { groupId: group.id, enrollment: { studentId: { in: selected }, student: { user: { role: "STUDENT" } } } }, include: { enrollment: true } }))
      .filter(row => inMembership(slot, row)).map(row => row.enrollment.studentId);
  if (selected.some(id => !eligible.includes(id))) fail("Студент не был записан на это занятие.", 403);
  const planId = group.planId;
  const occurrence = await tx.brsOccurrence.upsert({
    where: { planId_sourceKey: { planId, sourceKey: source } }, update: {},
    create: { planId, sourceKey: source, date: slot.date, startMinute: slot.record.startMinute, endMinute: slot.record.endMinute, kind: slot.record.lesson.kind },
  });
  for (const studentId of selected) {
    const key = { occurrenceId: occurrence.id, studentId };
    const before = await tx.brsAttendance.findUnique({ where: { occurrenceId_studentId: key } });
    if (input.number("version-" + studentId, 0, 2147483647) !== (before?.version ?? 0)) fail("Журнал изменился. Обновите страницу.", 409);
    if (before?.mark === mark) continue;
    const after = await tx.brsAttendance.upsert({ where: { occurrenceId_studentId: key },
      create: { ...key, authorId: actor.id, mark }, update: { authorId: actor.id, mark, version: { increment: 1 } } });
    await tx.brsAudit.create({ data: { actorId: actor.id, action: "PE_ATTENDANCE_MARK", objectId: after.id,
      planId, requestId: requestId + ":" + studentId, commandHash: "", beforeJson: JSON.stringify(before), afterJson: JSON.stringify(after), reason: "" } });
    await reviewFinal(tx, group.plan.termId, studentId);
  }
  return occurrence.id;
}

export async function assignTeacher(tx: PhysicalDB, actor: BrsActor, group: PhysicalGroup, input: PhysicalInput, now: Date, requestId: string) {
  administrative(actor);
  const teacherId = input.value("teacherId");
  if (!await tx.teacherProfile.count({ where: { userId: teacherId, user: { role: "TEACHER" } } })) fail("Преподаватель недоступен.");
  const { groupId, disciplineId, termId, term } = group.plan;
  const scope = { groupId, disciplineId, termId };
  const assigned = await teacherAssignments(tx, [group]);
  if (assigned.length === 1 && assigned[0].teacherId === teacherId) return assigned[0].id;
  const before = await loadScheduleRecords(tx);
  const date = currentAcademicDate(now, term.timeZone);
  const slots = groupPairs(effectiveSchedule(before, date, term.endsOn, "personal"), group)
    .filter(pair => !pair.cancelled && !started(pair, now));
  const activeMakeups = slots.filter(isMakeup);
  if (activeMakeups.length) fail("Отмените будущие отработки прежнего преподавателя перед сменой назначения.");
  const lesson = slots.length ? await tx.lesson.create({ data: { disciplineId, kind: "PRACTICE",
    groups: { create: { groupId } }, teachers: { create: { teacherId } } } }) : null;
  const updated = new Set<string>();
  for (const slot of slots) {
    if (!slot.entryId || !lesson) continue;
    const data = { lessonId: lesson.id, date: slot.date, roomId: slot.record.roomId, startMinute: slot.record.startMinute,
      endMinute: slot.record.endMinute, isCancelled: false, isPublished: true, isActive: true };
    const change = await tx.scheduleException.upsert({
      where: { entryId_sourceDate: { entryId: slot.entryId, sourceDate: slot.sourceDate } },
      create: { ...data, termId, entryId: slot.entryId, sourceDate: slot.sourceDate, version: slot.record.version + 1 },
      update: { ...data, version: { increment: 1 } },
    });
    updated.add(change.id);
  }
  const after = await loadScheduleRecords(tx);
  const all = effectiveSchedule(after, date, term.endsOn);
  verifyResources(all, all.filter(pair => updated.has(pair.record.id) && !pair.cancelled));
  await tx.teachingAssignment.updateMany({ where: { ...scope, teacherId: { not: teacherId }, isActive: true },
    data: { isActive: false, version: { increment: 1 } } });
  const key = { ...scope, teacherId };
  const saved = await tx.teachingAssignment.upsert({ where: { teacherId_groupId_disciplineId_termId: key },
    create: key, update: { isActive: true, confirmedAt: now, version: { increment: 1 } } });
  await tx.scheduleAudit.create({ data: { actorId: actor.id, objectId: group.id, action: "PE_TEACHER_CHANGE",
    beforeJson: JSON.stringify(assigned.map(row => row.teacherId)), afterJson: JSON.stringify({ teacherId, changed: [...updated] }),
    groups: { create: { groupId } } } });
  await emitScheduleChanges(tx, requestId, before, after, date, term.endsOn);
  return saved.id;
}

async function reviewFinal(tx: PhysicalDB, termId: string, studentId: string) {
  const enrollment = await tx.peEnrollment.findUnique({ where: { studentId_termId: { studentId, termId } }, select: { group: { select: { planId: true } } } });
  if (enrollment) await tx.brsFinal.updateMany({ where: { studentId, planId: enrollment.group.planId, needsReview: false },
    data: { needsReview: true, version: { increment: 1 } } });
}

export async function createWork(tx: PhysicalDB, actor: BrsActor, group: PhysicalGroup, input: PhysicalInput) {
  if (actor.role !== "TEACHER") administrative(actor);
  const kind = input.value("kind");
  if (kind !== "INTERIM" && kind !== "STANDARD") fail("Выберите норматив или рубежный контроль.");
  const limit = kind === "INTERIM" ? physicalLimits.controls : physicalLimits.standards;
  const maxScore = input.number("maximum", 1, limit / 100) * 100;
  const categories = input.categories();
  if (categories.some(category => !group.categories.some(item => item.category === category))) fail("Выберите категории, допущенные к занятиям в группе.");
  const brsModule = await tx.brsModule.findFirstOrThrow({ where: { planId: group.planId, number: 1 } });
  const existing = await tx.peWork.findMany({ where: { event: { moduleId: brsModule.id, kind } }, include: { event: true, categories: true } });
  if (categories.some(category => existing.filter(item => item.categories.some(scope => scope.category === category))
    .reduce((total, item) => total + item.event.maxScore, maxScore) > limit)) fail("Превышен фонд баллов по категории здоровья.");
  if (kind === "INTERIM" && existing.length) fail("В группе уже назначен рубежный контроль.");
  const plannedOn = input.value("date", 10, false) ? input.date("date") : null;
  const { term } = group.plan;
  if (plannedOn && (plannedOn < term.startsOn || plannedOn > term.endsOn)) fail("Дата должна входить в семестр.");
  const week = plannedOn ? Math.floor((+mondayOf(plannedOn) - +mondayOf(term.startsOn)) / WEEK_MS) + 1 : 1;
  const event = await tx.brsEvent.create({ data: { kind, moduleId: brsModule.id, maxScore, week, plannedOn,
    title: input.value("name"), number: existing.length + 1, required: false, labRequiresDefense: false,
    physicalWork: { create: { description: input.value("description", 1000, false), measurement: input.value("measurement", 300),
      criteria: input.value("criteria", 1000), categories: { create: categories.map(category => ({ category })) } } } } });
  return event.id;
}

export async function scoreWork(tx: PhysicalDB, actor: BrsActor, group: PhysicalGroup, input: PhysicalInput, now: Date, requestId: string) {
  teacher(actor);
  const studentId = input.value("studentId");
  if (!await tx.peEnrollment.count({ where: { groupId: group.id, studentId, student: { user: { role: "STUDENT" } } } })) fail("Студент не зачислен в группу.", 403);
  const work = await tx.peWork.findFirst({ where: { eventId: input.value("eventId"), event: { module: { planId: group.planId } } },
    include: { event: true, categories: true } });
  if (!work) fail("Работа недоступна.", 404);
  const health = await latestHealth(tx, studentId);
  if (!health || !work.categories.some(row => row.category === health.category)) fail("Работа недоступна для назначенной категории.", 403);
  const today = currentAcademicDate(now, group.plan.term.timeZone);
  if (today < group.plan.term.startsOn || work.event.plannedOn && work.event.plannedOn > today) fail("Работа ещё не проведена.");
  let score: number;
  try { score = parsePoints(input.value("score", 6)); } catch { return fail("Введите баллы с точностью до сотых."); }
  if (score > work.event.maxScore) fail("Балл превышает максимум работы.");
  const result = input.value("result", 300);
  const key = { eventId: work.eventId, studentId };
  const before = await tx.brsResult.findUnique({ where: { eventId_studentId: key } });
  if ((before?.version ?? 0) !== input.number("version", 0, 2147483647)) fail("Результат изменился. Обновите страницу.", 409);
  if (before?.score === score && before?.comment === result && !before.deleted) return before.id;
  const fields = { authorId: actor.id, score, scoreSource: "RATING", exactNumerator: String(score), exactDenominator: "1",
    performedOn: today, checkedOn: today, comment: result, commentVisible: true, deleted: false,
    submissionTiming: work.event.kind === "INTERIM" ? "ON_TIME" : null, passed: work.event.kind === "INTERIM" ? score * 2 >= work.event.maxScore : null };
  const after = await tx.brsResult.upsert({ where: { eventId_studentId: key }, create: { ...key, ...fields },
    update: { ...fields, version: { increment: 1 } } });
  await tx.brsAudit.create({ data: { actorId: actor.id, planId: group.planId, requestId: requestId + ":result", objectId: after.id,
    action: "PE_WORK_RESULT", commandHash: "", reason: "", beforeJson: JSON.stringify(before), afterJson: JSON.stringify(after) } });
  await reviewFinal(tx, group.plan.termId, studentId);
  await emitBrsChanges(tx, { key: requestId, planId: group.planId, eventId: work.eventId, studentId,
    before: { result: brsResultSignature(before), admission: "" }, after: { result: brsResultSignature(after), admission: "" } });
  return after.id;
}

export async function changeSlot(tx: PhysicalDB, actor: BrsActor, group: PhysicalGroup, input: PhysicalInput, now: Date, key: string, cancel: boolean) {
  if (actor.role !== "TEACHER") administrative(actor);
  const source = input.value("slot");
  const { term } = group.plan;
  const before = await loadScheduleRecords(tx);
  const original = groupPairs(effectiveSchedule(before, term.startsOn, term.endsOn, "personal"), group)
    .find(pair => pair.status !== "MOVED_FROM" && occurrenceKey(pair) === source);
  if (!original || original.cancelled) fail("Занятие недоступно.", 404);
  const record = original.record;
  if (actor.role === "TEACHER" && !record.lesson.teachers.some(row => row.teacherId === actor.id)) fail("Занятие назначено другому преподавателю.", 403);
  if (input.number("version", 1, 2147483647) !== record.version) fail("Занятие изменилось. Обновите страницу.", 409);
  if (!cancel && (isMakeup(original) || started(original, now))) fail("Перенести можно только предстоящее основное занятие.");
  const date = cancel ? original.date : input.date("date");
  const roomId = cancel ? record.roomId : input.value("roomId");
  const time = cancel ? { startMinute: record.startMinute, endMinute: record.endMinute } : input.time();
  if (date < term.startsOn || date > term.endsOn
    || !cancel && compareSlot(date, time.startMinute, term.timeZone, now) <= 0
    || !await tx.room.count({ where: { id: roomId } })) fail("Проверьте дату, время и аудиторию.");
  if (!cancel && +date !== +original.date && await tx.brsAttendance.count({ where: { occurrence: { sourceKey: source, planId: group.planId } } })) fail("Занятие с отметками нельзя перенести.");
  const data = { date, roomId, ...time, isCancelled: cancel, isActive: true, isPublished: true };
  const saved = original.exceptionId ? await tx.scheduleException.update({ where: { id: original.exceptionId }, data: { ...data, version: { increment: 1 } } })
    : await tx.scheduleException.create({ data: { ...data, version: record.version + 1, entryId: original.entryId, sourceDate: original.sourceDate, lessonId: record.lessonId, termId: term.id } });
  const after = await loadScheduleRecords(tx);
  const from = new Date(Math.min(+date, +original.date, +original.sourceDate));
  const to = new Date(Math.max(+date, +original.date, +original.sourceDate));
  if (cancel) {
    const marks = await tx.brsAttendance.findMany({ where: { occurrence: { sourceKey: source, planId: group.planId } }, select: { studentId: true } });
    for (const mark of marks) await reviewFinal(tx, group.plan.termId, mark.studentId);
  } else {
    const all = effectiveSchedule(after, from, to, "personal");
    const proposed = all.filter(pair => pair.record.id === saved.id && !pair.cancelled);
    verifyResources(all, proposed);
    const roster = await tx.peEnrollment.findMany({ where: { groupId: group.id, student: { user: { role: "STUDENT" } } },
      select: { studentId: true, student: { select: { group: { select: { slug: true } } } } } });
    for (const row of roster) await verifyStudentSchedule(tx, row.studentId, row.student.group?.slug, all, proposed);
  }
  const audit = await tx.scheduleAudit.create({ data: { actorId: actor.id, objectId: saved.id, action: cancel ? "CANCEL" : "REPLACE",
    beforeJson: JSON.stringify({ date: isoDate(original.date), roomId: record.roomId, startMinute: record.startMinute, endMinute: record.endMinute }),
    afterJson: JSON.stringify(saved), groups: { create: { groupId: group.plan.groupId } } } });
  await emitScheduleChanges(tx, key + ":" + audit.id, before, after, from, to);
  return saved.id;
}
