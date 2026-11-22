import "server-only";
import { randomUUID } from "node:crypto";
import { fail, type BrsActor } from "./brs-repository.ts";
import { getDeaneryContext } from "./deanery-repository.ts";
import { latestHealth } from "./physical-education-brs.ts";
import { physicalPlan, physicalLimits } from "./physical-education-rules.ts";
import { academicWeeks, currentAcademicDate, isoDate, mondayOf } from "./schedule-calendar.ts";
import { effectiveSchedule, loadScheduleRecords } from "./schedule-effective.ts";
import { administrative, studentFor, teacherAssignments, type PhysicalDB, type PhysicalGroup } from "./physical-education-access.ts";
import { compareSlot } from "./physical-education-schedule.ts";
import { groupPairs, isMakeup, started, verifyResources, verifyStudentSchedule } from "./physical-education-timetable.ts";
import { PhysicalInput } from "./physical-education-input.ts";

async function departmentFor(tx: PhysicalDB, actor: BrsActor, id: string) {
  const department = actor.role === "DEANERY_STAFF"
    ? (await getDeaneryContext(tx, actor)).departments.find(item => item.id === id)
    : await tx.academicDepartment.findUnique({ where: { id }, select: { id: true } });
  if (!department) fail("Подразделение недоступно.", 403);
  return department.id;
}

export async function createTerm(tx: PhysicalDB, actor: BrsActor, input: PhysicalInput) {
  // AcademicTerm is shared across departments and modules.
  if (actor.role !== "ADMIN") fail("Учебные периоды создаёт администратор.", 403);
  const startsOn = input.date("from"), endsOn = input.date("until");
  const weeks = academicWeeks(isoDate(startsOn), isoDate(endsOn));
  if (weeks.length < 3 || weeks.length > 52) fail("Учебный период должен занимать от 3 до 52 недель.");
  const code = input.value("code", 64);
  if (!/^[a-z0-9-]+$/.test(code) || await tx.academicTerm.count({ where: { code } })) fail("Укажите уникальный код из латинских букв, цифр и дефисов.");
  return (await tx.academicTerm.create({ data: { code, name: input.value("name"), startsOn, endsOn,
    firstNumeratorMonday: mondayOf(startsOn), timeZone: "Europe/Moscow", isPublished: true } })).id;
}

export async function createDirection(tx: PhysicalDB, actor: BrsActor, input: PhysicalInput) {
  if (actor.role !== "ADMIN") fail("Справочником направлений управляет администратор.", 403);
  const name = input.value("name", 80);
  return (await tx.peDirection.upsert({ where: { name }, create: { name }, update: {} })).id;
}

export async function assignHealth(tx: PhysicalDB, actor: BrsActor, input: PhysicalInput, now: Date) {
  administrative(actor);
  const student = await studentFor(tx, actor, input.value("studentId"));
  const categories = input.categories();
  if (categories.length !== 1) fail("Выберите одну группу здоровья.");
  const creditConditions = input.value("conditions", 500, false);
  const previous = await latestHealth(tx, student.userId);
  if (previous?.category === categories[0] && previous.creditConditions === creditConditions) return previous.id;
  const active = await tx.peEnrollment.findMany({ where: { studentId: student.userId }, include: { group: { include: { categories: true } }, term: true,
    memberships: { where: { endsAt: null }, select: { id: true } } } });
  for (const enrollment of active) {
    if (currentAcademicDate(now, enrollment.term.timeZone) > enrollment.term.endsOn) continue;
    if (enrollment.group.categories.some(item => item.category === categories[0])) {
      if (!enrollment.memberships.length) await tx.peMembership.create({ data: { enrollmentId: enrollment.id, groupId: enrollment.groupId,
        authorId: actor.id, startsAt: now, createdAt: now } });
      continue;
    }
    await tx.peMembership.updateMany({ where: { enrollmentId: enrollment.id, endsAt: null }, data: { endsAt: now } });
    const bookings = await tx.peBooking.findMany({ where: { studentId: student.userId, cancelledAt: null, makeup: { groupId: enrollment.groupId } }, include: { makeup: { include: { exception: true } } } });
    const future = bookings.filter(({ makeup: { exception } }) => compareSlot(exception.date, exception.startMinute, enrollment.term.timeZone, now) > 0);
    if (future.length) await tx.peBooking.updateMany({ where: { studentId: student.userId, makeupId: { in: future.map(row => row.makeupId) } }, data: { cancelledAt: now } });
  }
  return (await tx.peHealth.create({ data: { studentId: student.userId, authorId: actor.id, category: categories[0], creditConditions, assignedAt: now } })).id;
}

async function groupSettings(tx: PhysicalDB, input: PhysicalInput) {
  const registrationFrom = input.date("from"), registrationUntil = input.date("until");
  if (registrationFrom > registrationUntil) fail("Дата закрытия записи должна быть не раньше даты открытия.");
  const directionId = input.value("directionId");
  if (!await tx.peDirection.count({ where: { id: directionId } })) fail("Выберите спортивное направление.");
  return { name: input.value("name"), directionId, capacity: input.number("capacity", 1, 500),
    registrationFrom, registrationUntil, registrationOpen: input.value("open", 3, false) === "yes" };
}

export async function createGroup(tx: PhysicalDB, actor: BrsActor, input: PhysicalInput) {
  administrative(actor);
  const settings = await groupSettings(tx, input);
  const departmentId = await departmentFor(tx, actor, input.value("departmentId"));
  const term = await tx.academicTerm.findFirst({ where: { id: input.value("termId"), isPublished: true } });
  if (!term) fail("Выберите опубликованный семестр.");
  const weeks = academicWeeks(isoDate(term.startsOn), isoDate(term.endsOn));
  if (weeks.length < 3 || weeks.length > 52 || settings.registrationUntil > term.endsOn) fail("Проверьте границы семестра и периода записи.");
  const teacherId = input.value("teacherId");
  if (!await tx.teacherProfile.count({ where: { userId: teacherId, user: { role: "TEACHER" } } })) fail("Преподаватель недоступен.");
  const categories = input.categories();
  const slots = ["1", "2"].map(suffix => {
    const slot = new PhysicalInput({
      start: [input.value("start" + suffix)], end: [input.value("end" + suffix)],
    });
    return { ...slot.time(), roomId: input.value("room" + suffix), dayOfWeek: input.number("day" + suffix, 1, 7) };
  });
  if (slots[0].dayOfWeek === slots[1].dayOfWeek) fail("Укажите два разных дня недели.");
  if (await tx.room.count({ where: { id: { in: slots.map(slot => slot.roomId) } } }) !== new Set(slots.map(slot => slot.roomId)).size) fail("Выберите существующие места занятий.");
  const slug = "pe-" + randomUUID();
  const code = input.value("code", 48);
  if (await tx.studyGroup.count({ where: { code } })) fail("Код учебной группы уже используется.", 409);
  const group = await tx.studyGroup.create({ data: { slug, code, departmentId, programme: "Физическая культура", course: 0 } });
  const discipline = await tx.discipline.upsert({ where: { code: "PHYSICAL_EDUCATION" },
    create: { code: "PHYSICAL_EDUCATION", title: "Физкультура" }, update: {} });
  const plan = await tx.brsPlan.create({ data: { groupId: group.id, termId: term.id, disciplineId: discipline.id, control: "CREDIT",
    templateVersion: physicalPlan, publishedAt: new Date(),
    modules: { create: { number: 1, startWeek: 1, endWeek: weeks.length, seminarMax: physicalLimits.attendance,
      workMax: physicalLimits.standards, controlMax: physicalLimits.controls, state: "ACTIVE" } } } });
  await tx.teachingAssignment.create({ data: { groupId: group.id, termId: term.id, disciplineId: discipline.id, teacherId } });
  const lesson = await tx.lesson.create({ data: { disciplineId: discipline.id, kind: "PRACTICE", groups: { create: { groupId: group.id } }, teachers: { create: { teacherId } } } });
  const entries = await Promise.all(slots.map(slot => tx.scheduleEntry.create({ data: { ...slot, lessonId: lesson.id, termId: term.id, isPublished: true } })));
  const all = effectiveSchedule(await loadScheduleRecords(tx), term.startsOn, term.endsOn);
  const proposed = all.filter(pair => entries.some(entry => entry.id === pair.record.id));
  if (entries.some(entry => !proposed.some(slot => slot.record.id === entry.id))) fail("В семестре нет занятий в один из выбранных дней.");
  verifyResources(all, proposed);
  return (await tx.peGroup.create({ data: { ...settings, planId: plan.id, categories: { create: categories.map(category => ({ category })) } } })).id;
}

export async function updateGroup(tx: PhysicalDB, actor: BrsActor, group: PhysicalGroup, input: PhysicalInput) {
  administrative(actor);
  const settings = await groupSettings(tx, input);
  const categories = input.categories();
  const roster = await tx.peEnrollment.findMany({ where: { groupId: group.id }, select: { studentId: true } });
  if (settings.capacity < roster.length || settings.registrationUntil > group.plan.term.endsOn) fail("Проверьте вместимость и границы записи.");
  const health = await Promise.all(roster.map(row => latestHealth(tx, row.studentId)));
  if (health.some(item => item && !categories.includes(item.category))) fail("Сначала переведите студентов, которым больше не подходит группа.");
  await tx.peGroup.update({ where: { id: group.id }, data: { ...settings, categories: { deleteMany: {}, create: categories.map(category => ({ category })) } } });
  return group.id;
}

export async function enroll(tx: PhysicalDB, actor: BrsActor, group: PhysicalGroup, input: PhysicalInput, now: Date, mode: "apply" | "request" = "apply") {
  const self = actor.role === "STUDENT";
  if (!self) administrative(actor);
  const student = await studentFor(tx, actor, self ? actor.id : input.value("studentId"));
  if (student.educationStatus && student.educationStatus !== "STUDYING") fail("Запись доступна обучающимся студентам.");
  if (student.group?.departmentId !== group.plan.group.departmentId) fail("Группа недоступна студенту.", 403);
  const { term } = group.plan;
  const today = currentAcademicDate(now, term.timeZone);
  if (!term.isPublished || today > term.endsOn) fail("Учебный период завершён.");
  const previous = await tx.peEnrollment.findUnique({ where: { studentId_termId: { studentId: student.userId, termId: term.id } },
    include: { group: { include: { plan: { include: { group: true } } } } } });
  if (mode === "request" && (!previous || previous.groupId === group.id)) fail("Выберите другую спортивную группу текущего семестра.", 409);
  if (previous?.groupId === group.id) return previous.id;
  if (self && previous && mode === "apply") fail("Для смены группы подайте заявку на перевод.", 409);
  if (previous && (actor.role === "DEANERY_STAFF" || mode === "request") && previous.group.plan.group.departmentId !== student.group?.departmentId) {
    fail("Исходная спортивная группа находится вне вашего подразделения.", 403);
  }
  if (self && mode === "apply" && (!group.registrationOpen || today < group.registrationFrom || today > group.registrationUntil)) fail("Период записи закрыт.", 409);
  const health = await latestHealth(tx, student.userId);
  if (!health || !group.categories.some(item => item.category === health.category)) fail("Спортивная группа не соответствует назначенной группе здоровья.", 403);
  if (!await teacherAssignments(tx, [group]).then(rows => rows.length)) fail("У группы отсутствует действующее назначение преподавателя.");
  if (await tx.peEnrollment.count({ where: { groupId: group.id } }) >= group.capacity) fail("Нет свободных мест.", 409);
  const rangeStart = previous && today > term.startsOn ? today : term.startsOn;
  const records = await loadScheduleRecords(tx);
  const all = effectiveSchedule(records, rangeStart, term.endsOn, "personal");
  const proposed = groupPairs(all, group).filter(pair => !pair.cancelled && !isMakeup(pair) && (!previous || !started(pair, now)));
  if (!proposed.length) fail("В группе нет доступных занятий.");
  verifyResources(all, proposed);
  await verifyStudentSchedule(tx, student.userId, student.group?.slug, all, proposed, previous?.group.plan.groupId);
  if (mode === "request" && previous) return previous.id;
  if (previous) {
    const oldBookings = await tx.peBooking.findMany({ where: { studentId: student.userId, cancelledAt: null, makeup: { groupId: previous.groupId } },
      include: { makeup: { include: { exception: true } } } });
    const pending = oldBookings.filter(({ makeup: { exception } }) => compareSlot(exception.date, exception.startMinute, term.timeZone, now) > 0);
    await tx.peBooking.updateMany({ where: { studentId: student.userId, makeupId: { in: pending.map(row => row.makeupId) } }, data: { cancelledAt: now } });
    await tx.peMembership.updateMany({ where: { enrollmentId: previous.id, endsAt: null }, data: { endsAt: now } });
    await tx.peEnrollment.update({ where: { id: previous.id }, data: { groupId: group.id } });
    await tx.brsFinal.updateMany({ where: { planId: previous.group.planId, studentId: student.userId }, data: { planId: group.planId } });
    await tx.peMembership.create({ data: { enrollmentId: previous.id, groupId: group.id, authorId: actor.id, createdAt: now, startsAt: now } });
    return previous.id;
  }
  return (await tx.peEnrollment.create({ data: { studentId: student.userId, termId: term.id, groupId: group.id,
    memberships: { create: { groupId: group.id, authorId: actor.id, createdAt: now } } } })).id;
}
