import "server-only";
import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { fail, planInclude, type BrsActor } from "./brs-repository.ts";
import { points, officialState } from "./brs-rules.ts";
import { deaneryGroupWhere, getDeaneryContext } from "./deanery-repository.ts";
import { groupScopeFor, physicalActor, physicalGroupInclude, teacherAssignments, type PhysicalDB, type PhysicalGroup } from "./physical-education-access.ts";
import { latestHealth, physicalCalculation } from "./physical-education-brs.ts";
import { makeupInclude, registrationAvailable } from "./physical-education-journal.ts";
import { inMembership, occurrenceKey } from "./physical-education-schedule.ts";
import { ended, groupPairs, isMakeup, lessonView, started } from "./physical-education-timetable.ts";
import { currentAcademicDate, isoDate, minuteLabel, shortDayNames } from "./schedule-calendar.ts";
import { effectiveSchedule, loadScheduleRecords, type EffectivePair } from "./schedule-effective.ts";
import { readTransfers } from "./physical-education-transfers.ts";

const workInclude = { event: true, categories: true } satisfies Prisma.PeWorkInclude;
const marksText: Record<string, string> = { PRESENT: "Присутствовал", ACTIVE: "Присутствовал", ABSENT: "Отсутствовал", EXCUSED: "Уважительная причина" };

function groupCard(group: PhysicalGroup, rosterCount: number, assignment: Awaited<ReturnType<typeof teacherAssignments>>[number] | undefined, records: Awaited<ReturnType<typeof loadScheduleRecords>>, now: Date) {
  const plan = group.plan;
  return {
    id: group.id, planId: group.planId, name: group.name, code: plan.group.code, direction: group.direction.name, directionId: group.directionId,
    capacity: group.capacity, rosterCount, teacher: assignment?.teacher.name ?? "Нет действующего назначения", teacherId: assignment?.teacherId,
    open: registrationAvailable(group, now) && !!assignment,
    transferAvailable: !!assignment && plan.term.isPublished && currentAcademicDate(now, plan.term.timeZone) <= plan.term.endsOn,
    from: isoDate(group.registrationFrom), until: isoDate(group.registrationUntil),
    registrationOpen: group.registrationOpen, departmentId: plan.group.departmentId,
    term: { id: plan.term.id, name: plan.term.name, code: plan.term.code, start: isoDate(plan.term.startsOn), end: isoDate(plan.term.endsOn), timeZone: plan.term.timeZone },
    categories: group.categories.map(row => row.category),
    weekly: records.entries.filter(entry => entry.termId === plan.termId && entry.lesson.disciplineId === plan.disciplineId
      && entry.lesson.groups.some(link => link.groupId === plan.groupId)).map(entry => ({
      day: shortDayNames[entry.dayOfWeek - 1], start: minuteLabel(entry.startMinute), end: minuteLabel(entry.endMinute), place: entry.room.building.name + " · " + entry.room.number,
    })).sort((a, b) => shortDayNames.indexOf(a.day) - shortDayNames.indexOf(b.day)),
  };
}

function slotView(pair: EffectivePair, now: Date) {
  return { ...lessonView(pair), source: occurrenceKey(pair), version: pair.record.version,
    ended: ended(pair, now), started: started(pair, now), makeup: isMakeup(pair) };
}

async function totals(db: PhysicalDB, planId: string, studentIds: string[], now: Date, records: Awaited<ReturnType<typeof loadScheduleRecords>>) {
  if (!studentIds.length) return [];
  const plan = await db.brsPlan.findUniqueOrThrow({ where: { id: planId }, include: planInclude });
  const schedule = effectiveSchedule(records, plan.term.startsOn, plan.term.endsOn, "personal");
  const finals = await db.brsFinal.findMany({ where: { planId, studentId: { in: studentIds } } });
  return Promise.all(studentIds.map(async id => {
    const calc = await physicalCalculation(db, plan, id, now, schedule);
    const official = officialState(finals.find(item => item.studentId === id) ?? null, calc.calculation);
    return { id, counts: calc.calculation.physical!, score: points(calc.calculation.total), ready: calc.calculation.ready,
      official: official ? { grade: official.grade, valid: official.valid, status: official.status } : null, results: calc.results, attendance: calc.attendance };
  }));
}

function workCard(work: Prisma.PeWorkGetPayload<{ include: typeof workInclude }>) {
  return { id: work.eventId, name: work.event.title, control: work.event.kind === "INTERIM", maximum: points(work.event.maxScore),
    date: work.event.plannedOn ? isoDate(work.event.plannedOn) : "", description: work.description, measurement: work.measurement,
    criteria: work.criteria, categories: work.categories.map(row => row.category) };
}

async function makeups(db: PhysicalDB, groupIds: string[], now: Date, studentId?: string) {
  const rows = await db.peMakeup.findMany({ where: { groupId: { in: groupIds },
    ...(studentId ? { OR: [{ group: { enrollments: { some: { studentId } } } }, { bookings: { some: { studentId } } }] } : {}) },
    include: { ...makeupInclude, group: { include: { plan: { include: { term: true } } } },
      _count: { select: { bookings: { where: { cancelledAt: null } } } },
      ...(studentId ? { bookings: { where: { studentId }, select: { cancelledAt: true } } } : {}) },
    orderBy: [{ exception: { date: "desc" } }, { exception: { startMinute: "asc" } }] });
  return rows.map(row => {
    const event = row.exception, nowDate = currentAcademicDate(now, row.group.plan.term.timeZone);
    const view = { date: event.date, record: { ...event, term: row.group.plan.term } } as EffectivePair;
    return { id: row.id, groupId: row.groupId, source: "extra:" + event.id, date: isoDate(event.date), deadline: isoDate(row.bookingUntil),
      start: minuteLabel(event.startMinute), end: minuteLabel(event.endMinute), place: event.room.building.name + " · " + event.room.number,
      capacity: row.capacity, count: event.isCancelled ? 0 : row._count.bookings, comment: row.comment, cancelled: event.isCancelled,
      opened: !event.isCancelled && event.isActive && event.isPublished && nowDate <= row.bookingUntil && !started(view, now),
      booked: !!row.bookings?.some(booking => !booking.cancelledAt), withdrawn: !!row.bookings?.some(booking => booking.cancelledAt) };
  });
}

export async function physicalStudent(db: PrismaClient, actor: BrsActor, termId: string) {
  return db.$transaction(async tx => {
    await physicalActor(tx, actor);
    if (actor.role !== "STUDENT") fail("Доступ закрыт.", 403);
    const [profile, health, enrollments, groups, records] = await Promise.all([
      tx.studentProfile.findUnique({ where: { userId: actor.id }, include: { group: true } }),
      latestHealth(tx, actor.id),
      tx.peEnrollment.findMany({ where: { studentId: actor.id }, include: { memberships: true, term: true } }),
      tx.peGroup.findMany({ where: { plan: { term: { isPublished: true }, group: { departmentId: { not: null } } } }, include: physicalGroupInclude,
        orderBy: [{ plan: { term: { startsOn: "desc" } } }, { name: "asc" }] }),
      loadScheduleRecords(tx),
    ]);
    const now = new Date();
    const catalog = groups.filter(group => profile?.group?.departmentId === group.plan.group.departmentId);
    const terms = [...new Map([...catalog.map(group => group.plan.term), ...enrollments.map(enrollment => enrollment.term)]
      .map(term => [term.id, term])).values()].sort((a, b) => +b.startsOn - +a.startsOn);
    if (termId && !terms.some(term => term.id === termId)) fail("Учебный период недоступен.", 404);
    const current = terms.find(term => {
      const date = currentAcademicDate(now, term.timeZone);
      return term.startsOn <= date && term.endsOn >= date && enrollments.some(row => row.termId === term.id);
    }) ?? terms.find(term => {
      const date = currentAcademicDate(now, term.timeZone);
      return term.startsOn <= date && term.endsOn >= date;
    }) ?? terms[0];
    const term = termId ? terms.find(row => row.id === termId) : current;
    const enrollment = enrollments.find(row => row.termId === term?.id);
    const currentGroup = enrollment && groups.find(group => group.id === enrollment.groupId);
    const activeCatalog = catalog.filter(group => group.plan.termId === term?.id && (!health || group.categories.some(row => row.category === health.category)));
    const activeGroups = [...new Map([...activeCatalog, ...(currentGroup ? [currentGroup] : [])].map(group => [group.id, group])).values()];
    const ids = enrollment?.memberships.map(row => row.groupId) ?? [];
    const [counts, teachers, calculated, sessions, works, healthHistory] = await Promise.all([
      tx.peEnrollment.groupBy({ by: ["groupId"], where: { groupId: { in: activeGroups.map(row => row.id) } }, _count: { _all: true } }),
      teacherAssignments(tx, activeGroups),
      currentGroup ? totals(tx, currentGroup.planId, [actor.id], now, records).then(rows => rows[0]) : null,
      makeups(tx, ids, now, actor.id),
      tx.peWork.findMany({ where: { event: { module: { plan: { physicalGroup: { id: { in: ids } } } } } }, include: { ...workInclude, event: { include: { module: { select: { planId: true } } } } } }),
      tx.peHealth.findMany({ where: { studentId: actor.id }, orderBy: [{ assignedAt: "desc" }, { id: "desc" }], select: { id: true, category: true, assignedAt: true } }),
    ]);
    const cards = activeGroups.map(group => groupCard(group, counts.find(row => row.groupId === group.id)?._count._all ?? 0,
      teachers.find(row => row.groupId === group.plan.groupId), records, now));
    const pairs = term ? effectiveSchedule(records, term.startsOn, term.endsOn, "personal") : [];
    const schedule = enrollment ? pairs.filter(pair => {
      if (isMakeup(pair)) return sessions.some(row => row.source === occurrenceKey(pair) && row.booked);
      return enrollment.memberships.some(member => {
        const group = groups.find(row => row.id === member.groupId);
        return group && groupPairs([pair], group).length && inMembership(pair, member);
      });
    }).map(pair => {
      const mark = calculated?.attendance.find(row => row.occurrence.sourceKey === occurrenceKey(pair))?.mark;
      return { ...slotView(pair, now), mark: mark ? marksText[mark] : "Ожидает отметки" };
    }) : [];
    return {
      term: term?.id ?? "", terms: terms.map(row => ({ id: row.id, name: row.name })),
      transfers: await readTransfers(tx, actor, term?.id),
      health: health && { category: health.category, conditions: health.creditConditions, date: isoDate(currentAcademicDate(health.assignedAt)) },
      healthHistory: healthHistory.map(row => ({ id: row.id, category: row.category, date: isoDate(currentAcademicDate(row.assignedAt)) })),
      current: cards.find(card => card.id === currentGroup?.id) ?? null, groups: cards.filter(card => activeCatalog.some(group => group.id === card.id)),
      schedule, next: schedule.find(row => !row.ended && !row.change?.cancelled) ?? null,
      totals: calculated && { score: calculated.score, ready: calculated.ready, counts: calculated.counts, official: calculated.official },
      makeups: sessions.map(row => ({ ...row, attendance: calculated?.attendance.find(item => item.occurrence.sourceKey === row.source)?.mark ?? null })),
      works: works.flatMap(row => {
        const saved = calculated?.results.find(item => item.eventId === row.eventId);
        return saved || (currentGroup?.planId === row.event.module.planId && row.categories.some(scope => scope.category === health?.category)) ? [{ ...workCard(row), result: saved?.commentVisible ? saved.comment : "", score: saved ? points(saved.score) : "" }] : [];
      }),
    };
  }, { timeout: 30000 });
}

export async function physicalWorkspace(db: PrismaClient, actor: BrsActor, groupId: string, source: string, search: string) {
  return db.$transaction(async tx => {
    await physicalActor(tx, actor);
    if (!["TEACHER", "ADMIN", "DEANERY_STAFF"].includes(actor.role)) fail("Доступ закрыт.", 403);
    const teacher = actor.role === "TEACHER";
    const now = new Date();
    const all = await tx.peGroup.findMany({ where: groupScopeFor(actor), include: physicalGroupInclude,
      orderBy: [{ plan: { term: { startsOn: "desc" } } }, { name: "asc" }] });
    const assignments = await teacherAssignments(tx, all);
    const visible = teacher ? all.filter(group => assignments.some(link => link.groupId === group.plan.groupId && link.teacherId === actor.id)) : all;
    const selected = groupId ? visible.find(row => row.id === groupId) : visible[0];
    if (groupId && !selected) fail("Спортивная группа недоступна.", 404);
    const target = selected?.id ?? "";
    const [records, counts, rooms, departments, terms, directions, teachers, people] = await Promise.all([
      loadScheduleRecords(tx),
      tx.peEnrollment.groupBy({ by: ["groupId"], where: { groupId: { in: visible.map(row => row.id) } }, _count: { _all: true } }),
      teacher || selected || actor.role === "ADMIN" ? tx.room.findMany({ include: { building: true }, orderBy: [{ building: { name: "asc" } }, { number: "asc" }] }) : [],
      teacher ? [] : actor.role === "DEANERY_STAFF" ? (await getDeaneryContext(tx, actor)).departments : tx.academicDepartment.findMany({ orderBy: [{ faculty: "asc" }, { name: "asc" }] }),
      teacher ? [] : tx.academicTerm.findMany({ where: { isPublished: true }, orderBy: { startsOn: "desc" } }),
      teacher ? [] : tx.peDirection.findMany({ orderBy: { name: "asc" } }),
      teacher ? [] : tx.user.findMany({ where: { role: "TEACHER", teacherProfile: { isNot: null } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      teacher || !search ? [] : tx.studentProfile.findMany({ where: { user: { role: "STUDENT" }, ...(actor.role === "DEANERY_STAFF" ? { group: deaneryGroupWhere(actor) } : {}),
        OR: [{ user: { name: { contains: search } } }, { studentNumber: { contains: search } }, { group: { code: { contains: search } } }] },
        select: { userId: true, studentNumber: true, user: { select: { name: true } }, group: { select: { code: true, departmentId: true } },
          peHealth: { select: { category: true, assignedAt: true, creditConditions: true, id: true }, orderBy: [{ assignedAt: "desc" }, { id: "desc" }], take: 25 } },
        orderBy: { user: { name: "asc" } }, take: 25 }),
    ]);
    const cards = visible.map(group => groupCard(group, counts.find(row => row.groupId === group.id)?._count._all ?? 0,
      assignments.find(link => link.groupId === group.plan.groupId), records, now));
    const pairs = selected ? groupPairs(effectiveSchedule(records, selected.plan.term.startsOn, selected.plan.term.endsOn, "personal"), selected) : [];
    const slots = pairs.map(pair => slotView(pair, now));
    const chosen = pairs.find(pair => source === occurrenceKey(pair) && pair.status !== "MOVED_FROM")
      ?? [...pairs].reverse().find(pair => !pair.cancelled && ended(pair, now)) ?? pairs[0];
    const [roster, workRows, makeupRows, journal, marks] = await Promise.all([
      tx.peEnrollment.findMany({ where: { groupId: target, student: { user: { role: "STUDENT" },
        ...(actor.role === "DEANERY_STAFF" ? { group: deaneryGroupWhere(actor) } : {}) } },
        select: { studentId: true, student: { select: { user: { select: { name: true } } } } }, orderBy: { student: { user: { name: "asc" } } } }),
      tx.peWork.findMany({ where: { event: { module: { planId: selected?.planId ?? "" } } }, include: workInclude, orderBy: [{ event: { kind: "desc" } }, { event: { number: "asc" } }] }),
      teacher ? makeups(tx, [target], now) : [],
      !teacher || !chosen ? [] : isMakeup(chosen) ? tx.peBooking.findMany({ where: { makeup: { exceptionId: chosen.record.id }, cancelledAt: null, student: { user: { role: "STUDENT" } } },
        select: { studentId: true, student: { select: { user: { select: { name: true } } } } } })
        : tx.peMembership.findMany({ where: { groupId: target, enrollment: { student: { user: { role: "STUDENT" } } } },
          include: { enrollment: { select: { studentId: true, student: { select: { user: { select: { name: true } } } } } } } })
          .then(rows => rows.filter(row => inMembership(chosen, row)).map(row => row.enrollment)),
      teacher && chosen ? tx.brsAttendance.findMany({ where: { occurrence: { planId: selected?.planId, sourceKey: occurrenceKey(chosen) } } }) : [],
    ]);
    const enrolledIds = roster.map(row => row.studentId);
    const calculated = selected ? await totals(tx, selected.planId, enrolledIds, now, records) : [];
    const scopedHealth = teacher ? await Promise.all(enrolledIds.map(studentId => tx.peHealth.findFirst({
      where: { studentId }, select: { studentId: true, category: true }, orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
    }))) : [];
    return {
      groups: cards, selected: cards.find(card => card.id === target) ?? null, slots,
      transfers: await readTransfers(tx, actor),
      chosen: chosen ? slotView(chosen, now) : null,
      journal: journal.map(row => { const saved = marks.find(mark => mark.studentId === row.studentId);
        return { id: row.studentId, name: row.student.user.name, version: saved?.version ?? 0, mark: saved?.mark ? marksText[saved.mark] : "Без отметки" }; }),
      roster: roster.map(row => {
        const calc = calculated.find(item => item.id === row.studentId);
        return { id: row.studentId, name: row.student.user.name, health: scopedHealth.find(item => item?.studentId === row.studentId)?.category,
          score: calc?.score, ready: calc?.ready, visits: calc?.counts.visits, official: calc?.official,
          works: (calc?.results ?? []).filter(result => workRows.some(work => work.eventId === result.eventId))
            .map(result => ({ id: result.eventId, score: points(result.score).replace(",", "."), version: result.version, result: result.comment })) };
      }),
      works: workRows.map(workCard), makeups: makeupRows,
      rooms: rooms.map(room => ({ id: room.id, name: room.building.name + " · " + room.number })),
      departments: departments.map(row => ({ id: row.id, name: row.faculty + " · " + row.name })),
      terms: terms.map(row => ({ id: row.id, name: row.name })), directions, teachers,
      people: people.map(row => ({ id: row.userId, name: row.user.name, number: row.studentNumber, group: row.group?.code,
        departmentId: row.group?.departmentId, health: row.peHealth.map(item => ({ ...item, assignedAt: isoDate(currentAcademicDate(item.assignedAt)) })) })),
    };
  }, { timeout: 30000 });
}

export type PhysicalStudent = Awaited<ReturnType<typeof physicalStudent>>;
export type PhysicalWorkspace = Awaited<ReturnType<typeof physicalWorkspace>>;
