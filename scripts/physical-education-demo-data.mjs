import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { demoAccounts } from "../src/lib/demo-accounts.ts";
import { authorizePlan, calculateStudent } from "../src/lib/brs-repository.ts";
import { finalizeBrs } from "../src/lib/brs-commands.ts";
import { applyPhysicalCommand, lockPhysicalEducation } from "../src/lib/physical-education-commands.ts";
import { physicalGroupInclude } from "../src/lib/physical-education-access.ts";
import { ended, isMakeup, physicalPairs } from "../src/lib/physical-education-timetable.ts";
import { occurrenceKey } from "../src/lib/physical-education-schedule.ts";
import { currentAcademicDate, DAY_MS, isoDate, mondayOf } from "../src/lib/schedule-calendar.ts";

export const demoStudent = { id: "pe-demo-student-points", name: "Никита Примеров (демо)", role: "STUDENT", email: "pe.nikita@example.test" };
export const demoTeacher = { id: "pe-demo-teacher", name: "Анна Примерова (демо)", role: "TEACHER", email: "pe.anna@example.test" };
export const readyStudent = { id: "pe-demo-student-credit", name: "Елена Примерова (демо)", role: "STUDENT", email: "pe.elena@example.test" };
export const newPhysicalAccounts = [demoStudent, demoTeacher, readyStudent];
export const demoGroupCodes = ["ДЕМО-ФВ-01", "ДЕМО-ФВ-02", "ДЕМО-ФВ-03"];
const batchKey = "physical-education-local-demo-v1";
const key = input => "pe-demo-" + createHash("sha256").update(input).digest("hex").slice(0, 24);
const addDays = (date, days) => new Date(+date + days * DAY_MS);
const execute = (tx, actor, operation, label, values, at) => applyPhysicalCommand(tx, actor, {
  operation, requestId: key(label), fields: Object.fromEntries(Object.entries(values).map(([field, value]) => [field, Array.isArray(value) ? value : [String(value)]])),
}, at);

async function seedReadyStudent(tx, admin, teacher, alex, passwordHash) {
  const marker = batchKey + "-ready-account";
  if (await tx.brsAudit.findUnique({ where: { actorId_requestId: { actorId: admin.id, requestId: marker } } })) return false;
  assert(passwordHash && !await tx.user.findFirst({ where: { OR: [{ id: readyStudent.id }, { email: readyStudent.email }] } }), "Не удалось отделить новый синтетический аккаунт.");
  const profile = await tx.studentProfile.findUniqueOrThrow({ where: { userId: alex.id }, include: { group: true } });
  const group = await tx.peGroup.findFirstOrThrow({ where: { plan: { group: { code: demoGroupCodes[0] }, term: { code: "demo-autumn-2026" } } }, include: physicalGroupInclude });
  assert(profile.group?.slug === "pi-24-1" && profile.group.departmentId === group.plan.group.departmentId);
  const now = new Date(), start = new Date(+group.plan.term.startsOn + 8 * 3600000);
  await tx.user.create({ data: { ...readyStudent, emailVerified: true,
    accounts: { create: { providerId: "credential", accountId: readyStudent.id, password: passwordHash } },
    studentProfile: { create: { groupId: profile.group.id, groupName: profile.group.code, course: 2,
      studentNumber: "ДЕМО-ФВ-04", educationStatus: "STUDYING", firstName: "Елена", lastName: "Примерова" } },
  } });
  const command = (actor, operation, label, fields, at = now) => execute(tx, actor, operation, "ready-" + label, fields, at);
  await command(admin, "assign-health", "health", { studentId: readyStudent.id, category: "MAIN" }, start);
  await command(readyStudent, "enroll", "enroll", { groupId: group.id }, start);
  const sample = await tx.brsAttendance.findMany({ where: { studentId: alex.id, mark: "PRESENT", occurrence: { planId: group.planId } },
    select: { occurrence: { select: { sourceKey: true } } } });
  assert(sample.length === 25, "Эталонная демонстрационная посещаемость была изменена.");
  for (const { occurrence: { sourceKey } } of sample) {
    if (sourceKey.startsWith("extra:")) {
      const makeup = await tx.peMakeup.findUniqueOrThrow({ where: { exceptionId: sourceKey.slice(6) }, include: { exception: true } });
      await command(readyStudent, "book", "book-" + sourceKey, { groupId: group.id, makeupId: makeup.id }, addDays(makeup.exception.date, -1));
    }
    await command(teacher, "attendance", "mark-" + sourceKey, { groupId: group.id, slot: sourceKey,
      students: [readyStudent.id], mark: "PRESENT", ["version-" + readyStudent.id]: 0 });
  }
  const work = await tx.brsEvent.findFirstOrThrow({ where: { module: { planId: group.planId }, kind: "STANDARD" } });
  await command(teacher, "score-work", "score", { groupId: group.id, eventId: work.id, studentId: readyStudent.id,
    version: 0, score: 12, result: "Демонстрационный результат" });
  const plan = await authorizePlan(tx, teacher, group.planId);
  const final = await finalizeBrs(tx, teacher, plan, readyStudent.id, 0);
  assert.equal(final.score, 6200);
  await tx.brsPlan.update({ where: { id: plan.id }, data: { revision: { increment: 1 } } });
  await tx.brsAudit.create({ data: { actorId: teacher.id, action: "FINALIZE", planId: plan.id, objectId: readyStudent.id,
    requestId: key("ready-finalize"), commandHash: "", reason: "Синтетический демонстрационный зачёт", afterJson: JSON.stringify(final) } });
  await tx.brsAudit.create({ data: { actorId: admin.id, requestId: marker, objectId: readyStudent.id, action: "PE_DEMO_SEEDED", reason: "", commandHash: "" } });
  return true;
}

export async function seedPhysicalEducation(db, passwordHashes) {
  return db.$transaction(async tx => {
    await lockPhysicalEducation(tx);
    const identities = demoAccounts.filter(account => ["alexander.smirnov", "maria.volkova", "irina.lebedeva", "mikhail.sokolov"].some(name => account.email === name + "@example.test"));
    const lookup = async ({ email, name, role }) => {
      const record = await tx.user.findUnique({ where: { email }, select: { id: true, name: true, role: true } });
      assert(record?.name === name && record.role === role, "Не найден однозначно синтетический аккаунт " + email);
      assert(await tx.account.count({ where: { userId: record.id, providerId: "credential", password: { not: null } } }), "У демонстрационного аккаунта отсутствует вход по паролю.");
      return record;
    };
    const [alex, maria, admin, teacher] = await Promise.all(identities.map(lookup));
    const marker = await tx.brsAudit.findUnique({ where: { actorId_requestId: { actorId: admin.id, requestId: batchKey } } });
    if (marker) return { inserted: await seedReadyStudent(tx, admin, teacher, alex, passwordHashes[readyStudent.email]) };
    const [alexProfile, mariaProfile] = await Promise.all([alex, maria].map(student => tx.studentProfile.findUnique({ where: { userId: student.id }, include: { group: true } })));
    assert(alexProfile?.group?.slug === "pi-24-1" && mariaProfile?.group?.slug === "pi-24-1"
      && alexProfile.group.departmentId && alexProfile.group.departmentId === mariaProfile.group.departmentId, "Учебные группы демонстрационных аккаунтов изменились.");
    assert(await tx.teacherProfile.count({ where: { userId: teacher.id } }), "Не найден профиль демонстрационного преподавателя.");
    const term = await tx.academicTerm.findUnique({ where: { code: "demo-autumn-2026" } });
    const now = new Date();
    const today = currentAcademicDate(now, term?.timeZone);
    assert(term?.isPublished && today >= addDays(term.startsOn, 12 * 7 - 2) && today <= addDays(term.endsOn, -8), "Текущий день не подходит для исходного демо-семестра с прошлой и будущей посещаемостью.");
    const dept = alexProfile.group.departmentId;
    assert(!await tx.user.findFirst({ where: { OR: [{ id: { in: [demoStudent.id, demoTeacher.id] } }, { email: { in: [demoStudent.email, demoTeacher.email] } }] } }), "Идентификатор нового синтетического аккаунта уже используется.");
    for (const student of [alex, maria]) {
      assert(!await tx.peHealth.count({ where: { studentId: student.id } }) && !await tx.peEnrollment.count({ where: { studentId: student.id } }), "У демонстрационного студента уже заведена физкультура.");
    }
    await tx.user.create({ data: { ...demoStudent, emailVerified: true,
      accounts: { create: { providerId: "credential", accountId: demoStudent.id, password: passwordHashes[demoStudent.email] } },
      studentProfile: { create: { groupId: alexProfile.group.id, groupName: alexProfile.group.code, course: 2,
        studentNumber: "ДЕМО-ФВ-03", educationStatus: "STUDYING", firstName: "Никита", lastName: "Примеров" } } } });
    const otherTeacher = await tx.user.create({ data: { ...demoTeacher, emailVerified: true,
      accounts: { create: { providerId: "credential", accountId: demoTeacher.id, password: passwordHashes[demoTeacher.email] } },
      teacherProfile: { create: { department: "Демонстрационная физкультура", position: "Преподаватель" } },
    }, select: { id: true, role: true } });
    const building = await tx.building.create({ data: { name: "Демонстрационный спортивный корпус", code: "pe-demo-sports" } });
    const hall = await tx.room.create({ data: { buildingId: building.id, number: "Зал 1" } });
    const second = await tx.room.create({ data: { buildingId: building.id, number: "Зал 2" } });

    const command = (actor, operation, label, values, at = now) => execute(tx, actor, operation, label, values, at);
    const registration = { from: isoDate(term.startsOn), until: isoDate(addDays(term.endsOn, -6)), open: "yes", termId: term.id, departmentId: dept };
    const allCategories = ["MAIN", "PREPARATORY", "SPECIAL", "INDIVIDUAL"];
    const areas = await Promise.all(["Волейбол", "Общая физическая подготовка", "Оздоровительная гимнастика"]
      .map((name, index) => command(admin, "create-direction", "direction-" + index, { name })));
    const createGroup = (index, assigned, name, capacity, category, day1, day2, start, end, room) => command(admin, "create-group", "group-" + index, {
      ...registration, directionId: areas[index], code: demoGroupCodes[index], teacherId: assigned.id, name,
      capacity, category, day1, day2, start1: start, end1: end, start2: start, end2: end, room1: room.id, room2: room.id,
    });
    const a = await createGroup(0, teacher, "Волейбол", 30, ["MAIN"], 4, 6, "16:00", "17:00", hall);
    const b = await createGroup(1, otherTeacher, "ОФП", 1, ["MAIN", "PREPARATORY"], 2, 6, "17:15", "18:15", second);
    const c = await createGroup(2, teacher, "Оздоровительная гимнастика", 12, allCategories, 1, 3, "16:30", "17:30", hall);
    const groups = await tx.peGroup.findMany({ where: { id: { in: [a, b, c] } }, include: physicalGroupInclude });
    const groupA = groups.find(group => group.id === a), groupB = groups.find(group => group.id === b);
    const launch = new Date(+term.startsOn + 8 * 60 * 60 * 1000);
    await command(admin, "assign-health", "alex-health", { studentId: alex.id, category: ["MAIN"] }, launch);
    await command(admin, "assign-health", "maria-health", { studentId: maria.id, category: ["PREPARATORY"],
      conditions: "Для демонстрации предусмотрены адаптированные задания с индивидуальным темпом." }, launch);
    await command(admin, "assign-health", "nikita-health-history", { studentId: demoStudent.id, category: ["SPECIAL"] }, launch);
    await command(admin, "assign-health", "nikita-health", { studentId: demoStudent.id, category: ["MAIN"] }, addDays(launch, 1));
    for (const [student, groupId] of [[alex, a], [maria, b], [demoStudent, a]]) {
      await command(student, "enroll", "enroll-" + student.id, { groupId }, addDays(launch, 1));
    }
    const past = (await physicalPairs(tx, groupA)).filter(slot => ended(slot, now) && !isMakeup(slot));
    const pastB = (await physicalPairs(tx, groupB)).filter(slot => ended(slot, now) && !isMakeup(slot));
    assert(past.length >= 24 && pastB.length >= 24, "Недостаточно прошедших учебных занятий для исходного демо.");
    const cancelled = past.at(-1);
    await command(teacher, "cancel-slot", "cancelled-regular", { groupId: a, slot: occurrenceKey(cancelled), version: cancelled.record.version });
    for (const slot of past.filter(slot => slot !== cancelled).slice(0, 23)) {
      const slotKey = occurrenceKey(slot);
      await command(teacher, "attendance", "attendance-a-" + slotKey, {
        groupId: a, slot: slotKey, students: [alex.id, demoStudent.id], mark: "PRESENT", ["version-" + alex.id]: 0, ["version-" + demoStudent.id]: 0,
      });
    }
    for (const slot of pastB.slice(0, 24)) {
      const slotKey = occurrenceKey(slot);
      await command(otherTeacher, "attendance", "attendance-b-" + slotKey, { groupId: b, slot: slotKey, students: [maria.id], mark: "PRESENT", ["version-" + maria.id]: 0 });
    }
    const makeup = (label, date, options = {}) => command(teacher, "create-makeup", label, {
      groupId: a, date: isoDate(date), until: isoDate(date), start: "15:45", end: "16:30",
      roomId: second.id, capacity: options.capacity ?? 6, comment: options.comment ?? "Демонстрационное занятие",
    }, options.at ?? now);
    for (const [index, day] of [6, 13].entries()) {
      const date = addDays(mondayOf(term.startsOn), day);
      const created = addDays(date, -1);
      const id = await makeup("past-makeup-" + index, date, { at: created, comment: "Демонстрационная отработка пропущенного занятия" });
      const source = "extra:" + (await tx.peMakeup.findUniqueOrThrow({ where: { id } })).exceptionId;
      for (const student of [alex, demoStudent]) await command(student, "book", "past-booking-" + index + "-" + student.id, { groupId: a, makeupId: id }, created);
      await command(teacher, "attendance", "past-confirmation-" + index, {
        groupId: a, slot: source, students: [alex.id, demoStudent.id], mark: "PRESENT", ["version-" + alex.id]: 0, ["version-" + demoStudent.id]: 0,
      });
    }
    const upcoming = addDays(mondayOf(today), 13);
    const ids = [];
    for (const [index, days] of [0, 7, 14].entries()) ids.push(await makeup("future-makeup-" + index, addDays(upcoming, days), { capacity: index === 0 ? 1 : 6 }));
    await command(alex, "book", "booked-demo", { groupId: a, makeupId: ids[0] });
    await command(alex, "book", "cancelled-demo", { groupId: a, makeupId: ids[1] });
    const cancelledMakeup = await tx.peMakeup.findUniqueOrThrow({ where: { id: ids[1] } });
    await command(teacher, "cancel-slot", "cancel-makeup", { groupId: a, slot: "extra:" + cancelledMakeup.exceptionId, version: 1 });
    const standard = (assigned, groupId, label, name, category, maximum, kind = "STANDARD") => command(assigned, "create-work", label, {
      groupId, kind, name, category, maximum, date: isoDate(addDays(term.startsOn, 20)), description: "Синтетический учебный пример.",
      measurement: "Демонстрационный протокол выполнения", criteria: "В демонстрации оцениваются техника и выполнение задания по критериям преподавателя.",
    });
    const standardA = await standard(teacher, a, "standard-a", "Техника передачи мяча", ["MAIN"], 20);
    const standardB = await standard(otherTeacher, b, "standard-b", "Адаптированный комплекс упражнений", ["PREPARATORY"], 20);
    const interim = await standard(otherTeacher, b, "interim-b", "Контроль техники упражнений", ["PREPARATORY", "MAIN"], 5, "INTERIM");
    await standard(teacher, c, "individual-c", "Индивидуальный учебный комплекс", ["SPECIAL", "INDIVIDUAL"], 20);
    for (const [appointed, groupId, eventId, student, score] of [
      [teacher, a, standardA, alex, 12], [teacher, a, standardA, demoStudent, 5],
      [otherTeacher, b, standardB, maria, 16], [otherTeacher, b, interim, maria, 5],
    ]) await command(appointed, "score-work", "score-" + eventId + "-" + student.id, {
      groupId, eventId, studentId: student.id, version: 0, score, result: "Демонстрационный результат",
    });
    const plan = await authorizePlan(tx, teacher, groupA.planId);
    const official = await finalizeBrs(tx, teacher, plan, alex.id, 0);
    await tx.brsPlan.update({ where: { id: plan.id }, data: { revision: { increment: 1 } } });
    await tx.brsAudit.create({ data: { actorId: teacher.id, action: "FINALIZE", planId: plan.id, objectId: alex.id,
      requestId: key("finalize"), commandHash: "", reason: "Синтетический демонстрационный зачёт", afterJson: JSON.stringify(official) } });
    for (const [student, selectedPlan, visits, score] of [[alex, plan, 25, 6200], [demoStudent, plan, 25, 5500],
      [maria, await authorizePlan(tx, otherTeacher, groupB.planId), 24, 6900]]) {
      const calculation = (await calculateStudent(tx, selectedPlan, student.id)).calculation;
      assert(calculation.physical?.visits === visits && calculation.total === score, "Демонстрационный расчёт расходится с исходными сценариями.");
    }
    await tx.brsAudit.create({ data: { actorId: admin.id, requestId: batchKey, objectId: a, action: "PE_DEMO_SEEDED", reason: "", commandHash: "" } });
    await seedReadyStudent(tx, admin, teacher, alex, passwordHashes[readyStudent.email]);
    return { inserted: true, groups: demoGroupCodes, students: 4 };
  }, { timeout: 60000, maxWait: 15000 });
}
