import "server-only";
import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { deaneryGroupWhere, requireDeaneryGroup } from "./deanery-repository.ts";
import { isSessionWithinLifetime } from "./session-policy.ts";
import { calculateBrs, effectiveModules, workStatus } from "./brs-rules.ts";
import { brsSchedule } from "./brs-schedule.ts";
import { isoDate, currentAcademicDate, academicWeeks } from "./schedule-calendar.ts";

export type BrsActor = { id: string; role: string; sessionId?: string };
export type BrsDB = Prisma.TransactionClient;
export class BrsError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }
export function fail(message: string, status = 400): never { throw new BrsError(message, status); }
export function bounded<T>(rows: T[], max: number): T[] { if (rows.length > max) fail("Объём данных превышает лимит. Требуется расширение серверной выборки."); return rows; }
export async function freshActor(db: BrsDB, actor: BrsActor, mutation = false) {
  const user = await db.user.findUnique({ where: { id: actor.id }, select: { role: true } });
  if (!user || user.role !== actor.role || !["STUDENT", "TEACHER", "DEANERY_STAFF"].includes(user.role)) fail("Доступ закрыт. Полномочия изменились.", 403);
  if (mutation) {
    const session = actor.sessionId ? await db.session.findFirst({ where: { id: actor.sessionId, userId: actor.id } }) : null;
    if (!session || !isSessionWithinLifetime(session)) fail("Сессия завершена. Войдите снова.", 401);
  }
}
export const planInclude = { group: { select: { id: true, code: true } }, discipline: { select: { id: true, title: true } }, term: true,
  modules: { orderBy: { number: "asc" }, include: { events: { orderBy: [{ week: "asc" }, { number: "asc" }, { id: "asc" }] } } },
  occurrences: { orderBy: [{ date: "asc" }, { startMinute: "asc" }] } } satisfies Prisma.BrsPlanInclude;
export type FullPlan = Prisma.BrsPlanGetPayload<{ include: typeof planInclude }>;
export async function authorizePlan(db: BrsDB, actor: BrsActor, planId: string) {
  await freshActor(db, actor);
  const plan = await db.brsPlan.findUnique({ where: { id: planId }, include: planInclude });
  if (!plan) fail("План недоступен.", 404);
  if (actor.role === "DEANERY_STAFF") await requireDeaneryGroup(db, actor, { id: plan.groupId });
  else if (actor.role === "TEACHER") {
    const assignment = await db.teachingAssignment.findFirst({ where: { teacherId: actor.id, groupId: plan.groupId, disciplineId: plan.disciplineId, termId: plan.termId, isActive: true, teacher: { role: "TEACHER" } } });
    if (!assignment) fail("Действующее учебное назначение отсутствует.", 403);
  } else {
    const profile = await db.studentProfile.findUnique({ where: { userId: actor.id }, select: { groupId: true } });
    const history = await db.brsResult.count({ where: { studentId: actor.id, event: { module: { planId } } } })
      + await db.brsExamAttempt.count({ where: { planId, studentId: actor.id } })
      + await db.brsAttendance.count({ where: { studentId: actor.id, occurrence: { planId } } })
      + await db.brsFinal.count({ where: { planId, studentId: actor.id } });
    if (!plan.publishedAt || profile?.groupId !== plan.groupId && !history) fail("План недоступен.", 403);
  }
  return plan;
}
export async function studentInPlan(db: BrsDB, actor: BrsActor, plan: FullPlan, studentId: string, allowHistory = false) {
  if (actor.role === "STUDENT" && actor.id !== studentId) fail("Студент недоступен.", 403);
  const profile = await db.studentProfile.findFirst({ where: { userId: studentId, user: { role: "STUDENT" } }, select: { groupId: true } });
  if (profile?.groupId !== plan.groupId && !allowHistory) fail("Студент не входит в выбранную группу.", 403);
}
export async function calculateStudent(db: BrsDB, plan: FullPlan, studentId: string) {
  const results = bounded(await db.brsResult.findMany({ where: { studentId, event: { module: { planId: plan.id } } } }), 5000);
  const attempts = bounded(await db.brsExamAttempt.findMany({ where: { planId: plan.id, studentId }, orderBy: { number: "asc" } }), 200);
  const admission = await db.brsAdmission.findUnique({ where: { planId_studentId: { planId: plan.id, studentId } } });
  const attendance = bounded(await db.brsAttendance.findMany({ where: { studentId, occurrence: { planId: plan.id } } }), 5000);
  const modules = effectiveModules(plan.modules, results, attendance);
  return { calculation: calculateBrs(plan.control, modules, attempts, admission), results, attempts, admission, attendance, modules };
}
export async function getBrsWorkspace(db: PrismaClient, actor: BrsActor, planId = "") {
  return db.$transaction(async tx => {
    await freshActor(tx, actor);
    const scope: Prisma.BrsPlanWhereInput = actor.role === "DEANERY_STAFF" ? { group: deaneryGroupWhere(actor) }
      : actor.role === "TEACHER" ? { AND: [{ group: { teachingAssignments: { some: { teacherId: actor.id, isActive: true } } } }] }
      : { publishedAt: { not: null }, OR: [{ group: { students: { some: { userId: actor.id } } } }, { modules: { some: { events: { some: { results: { some: { studentId: actor.id } } } } } } }, { attempts: { some: { studentId: actor.id } } }, { occurrences: { some: { attendance: { some: { studentId: actor.id } } } } }, { finals: { some: { studentId: actor.id } } }] };
    let plans = bounded(await tx.brsPlan.findMany({ where: scope, select: { id: true, groupId: true, disciplineId: true, termId: true, control: true, publishedAt: true, group: { select: { code: true } }, discipline: { select: { title: true } }, term: { select: { name: true } } }, orderBy: [{ term: { startsOn: "desc" } }, { discipline: { title: "asc" } }], take: 501 }), 500);
    if (actor.role === "TEACHER") {
      const assignments = bounded(await tx.teachingAssignment.findMany({ where: { teacherId: actor.id, isActive: true }, take: 501 }), 500);
      plans = plans.filter(plan => assignments.some(a => a.groupId === plan.groupId && a.disciplineId === plan.disciplineId && a.termId === plan.termId));
    }
    if (planId && !plans.some(plan => plan.id === planId)) fail("План недоступен.", 403);
    const selectedId = planId || plans[0]?.id;
    const catalog = actor.role === "DEANERY_STAFF" ? {
      groups: bounded(await tx.studyGroup.findMany({ where: deaneryGroupWhere(actor), select: { id: true, code: true }, orderBy: { code: "asc" }, take: 501 }), 500),
      disciplines: bounded(await tx.discipline.findMany({ select: { id: true, title: true }, orderBy: { title: "asc" }, take: 2001 }), 2000),
      terms: bounded(await tx.academicTerm.findMany({ select: { id: true, name: true }, orderBy: { startsOn: "desc" }, take: 101 }), 100),
      teachers: bounded(await tx.user.findMany({ where: { role: "TEACHER" }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 501 }), 500),
      assignments: bounded(await tx.teachingAssignment.findMany({ where: { group: deaneryGroupWhere(actor) }, include: { teacher: { select: { name: true } }, group: { select: { code: true } }, discipline: { select: { title: true } }, term: { select: { name: true } } }, take: 1001 }), 1000),
    } : null;
    if (!selectedId) return { role: actor.role, actorId: actor.id, plans, catalog, overview: [], selected: null };
    const plan = await authorizePlan(tx, actor, selectedId);
    const where: Prisma.UserWhereInput = actor.role === "STUDENT" ? { id: actor.id } : { role: "STUDENT", OR: [{ studentProfile: { groupId: plan.groupId } }, ...(actor.role === "TEACHER" ? [{ brsResults: { some: { event: { module: { planId: plan.id } } } } }, { brsAttendance: { some: { occurrence: { planId: plan.id } } } }, { brsAttempts: { some: { planId: plan.id } } }] : [])] };
    const roster = bounded(await tx.user.findMany({ where, select: { id: true, name: true, studentProfile: { select: { groupId: true } } }, orderBy: { name: "asc" }, take: 1001 }), 1000);
    const studentIds = roster.map(student => student.id);
    const results = bounded(await tx.brsResult.findMany({ where: { studentId: { in: studentIds }, event: { module: { planId: plan.id } } }, select: {
      id: true, eventId: true, studentId: true, authorId: true, score: true, primaryScore: true, primaryMax: true, submissionTiming: true, passed: true, labStatus: true, submittedOn: true, checkedOn: true, performedOn: true, defendedOn: true, commentVisible: true,
      ...(actor.role === "TEACHER" ? { comment: true } : {}), deleted: true, version: true,
    }, take: 20001 }), 20000);
    // Private comments are not even selected for student/deanery payloads.
    const visibleComments = actor.role !== "TEACHER" ? await tx.brsResult.findMany({ where: { studentId: { in: studentIds }, event: { module: { planId: plan.id } }, commentVisible: true }, select: { id: true, comment: true } }) : [];
    const safeResults = results.map(result => ({ ...result, comment: "comment" in result && typeof result.comment === "string" ? result.comment : visibleComments.find(comment => comment.id === result.id)?.comment ?? "" }));
    const attempts = bounded(await tx.brsExamAttempt.findMany({ where: { planId: plan.id, studentId: { in: studentIds } }, select: { id: true, studentId: true, authorId: true, number: true, score: true, passed: true, heldOn: true, version: true, deleted: true, admissionVersion: true, commentVisible: true, ...(actor.role === "TEACHER" ? { comment: true } : {}) }, orderBy: { number: "asc" }, take: 2001 }), 2000);
    const publicAttemptComments = actor.role !== "TEACHER" ? await tx.brsExamAttempt.findMany({ where: { planId: plan.id, studentId: { in: studentIds }, commentVisible: true }, select: { id: true, comment: true } }) : [];
    const safeAttempts = attempts.map(attempt => ({ ...attempt, comment: "comment" in attempt && typeof attempt.comment === "string" ? attempt.comment : publicAttemptComments.find(item => item.id === attempt.id)?.comment ?? "" }));
    const admissions = await tx.brsAdmission.findMany({ where: { planId: plan.id, studentId: { in: studentIds } }, include: { author: { select: { name: true } } } });
    const finals = await tx.brsFinal.findMany({ where: { planId: plan.id, studentId: { in: studentIds } }, select: { studentId: true, score: true, rating: true, grade: true, needsReview: true, approvedAt: true, version: true, author: { select: { name: true } } } });
    const attendance = bounded(await tx.brsAttendance.findMany({ where: { studentId: { in: studentIds }, occurrence: { planId: plan.id } }, take: 20001 }), 20000);
    const schedule = await brsSchedule(tx, plan);
    const occurrences = plan.occurrences.map(occurrence => {
      const live = schedule.find(pair => pair.sourceKey === occurrence.sourceKey);
      return { ...occurrence, actualDate: live?.date ?? isoDate(occurrence.date), actualStart: live?.startMinute ?? occurrence.startMinute,
        actualEnd: live?.endMinute ?? occurrence.endMinute,
        cancelled: !live || live.cancelled, changed: !!live && (live.date !== isoDate(occurrence.date) || live.startMinute !== occurrence.startMinute), conflict: !live || live.cancelled || live.kind !== occurrence.kind };
    });
    const history = actor.role === "DEANERY_STAFF" ? await tx.brsAudit.findMany({ where: { planId: plan.id, action: { in: ["CONFIRM", "REVOKE", "INVALIDATE"] }, objectId: { in: studentIds } }, select: { id: true, objectId: true, action: true, reason: true, createdAt: true, actor: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 201 }) : [];
    const students = roster.map(student => {
      const studentResults = safeResults.filter(result => result.studentId === student.id);
      const studentAttempts = safeAttempts.filter(attempt => attempt.studentId === student.id);
      const admission = admissions.find(item => item.studentId === student.id) ?? null;
      const modules = effectiveModules(plan.modules, studentResults, attendance.filter(item => item.studentId === student.id));
      return { id: student.id, name: student.name, former: student.studentProfile?.groupId !== plan.groupId, results: studentResults, attempts: studentAttempts, admission,
        attendance: attendance.filter(item => item.studentId === student.id), official: finals.find(item => item.studentId === student.id) ?? null,
        calculation: calculateBrs(plan.control, modules, studentAttempts, admission) };
    });
    const today = isoDate(currentAcademicDate());
    const modules = plan.modules.map(brsModule => ({ ...brsModule, events: brsModule.events.map(event => ({ ...event,
      actualOn: event.occurrenceId ? occurrences.find(occurrence => occurrence.id === event.occurrenceId)?.actualDate ?? (event.plannedOn ? isoDate(event.plannedOn) : null) : event.plannedOn ? isoDate(event.plannedOn) : null,
      scheduleConflict: !!event.occurrenceId && !!occurrences.find(occurrence => occurrence.id === event.occurrenceId)?.conflict,
    })) }));
    const overview = [];
    if (actor.role === "STUDENT") for (const item of bounded(plans.filter(item => item.termId === plan.termId), 50)) {
      const course = item.id === plan.id ? plan : await authorizePlan(tx, actor, item.id);
      const own = await calculateStudent(tx, course, actor.id);
      const ownSchedule = course.id === plan.id ? schedule : await brsSchedule(tx, course);
      overview.push({ id: course.id, title: course.discipline.title, control: course.control, calculation: own.calculation,
        attendance: own.attendance.map(item => ({ occurrenceId: item.occurrenceId, mark: item.mark })),
        occurrences: course.occurrences.map(item => {
          const live = ownSchedule.find(pair => pair.sourceKey === item.sourceKey);
          return { id: item.id, actualDate: live?.date ?? isoDate(item.date), actualStart: live?.startMinute ?? item.startMinute, actualEnd: live?.endMinute ?? item.endMinute, cancelled: !live || live.cancelled };
        }),
        modules: own.modules.map(brsModule => ({ id: brsModule.id, number: brsModule.number, startWeek: brsModule.startWeek, endWeek: brsModule.endWeek, events: brsModule.events.map(event => ({
          ...event, result: event.result && !event.result.deleted ? { score: event.result.score, primaryScore: event.result.primaryScore ?? null, primaryMax: event.result.primaryMax ?? null, labStatus: event.result.labStatus, defendedOn: event.result.defendedOn ?? null } : null,
          score: event.result && !event.result.deleted ? event.result.score : null, status: workStatus(event, event.result),
          comment: own.results.find(result => result.eventId === event.id && !result.deleted && result.commentVisible)?.comment ?? "",
        })) })),
        official: await tx.brsFinal.findUnique({ where: { planId_studentId: { planId: course.id, studentId: actor.id } }, select: { grade: true, rating: true, needsReview: true } }) });
    }
    return { role: actor.role, actorId: actor.id, plans, catalog, overview, selected: { ...plan, modules, occurrences, students, schedule, history,
      weeks: academicWeeks(isoDate(plan.term.startsOn), isoDate(plan.term.endsOn)), today } };
  }, { timeout: 30000, maxWait: 10000 });
}
// JSON serialization is intentional: client data contains calendar strings, not Date objects.
export type BrsWorkspace = ReturnType<typeof serializeWorkspace>;
export function serializeWorkspace(model: Awaited<ReturnType<typeof getBrsWorkspace>>) {
  type Jsonify<T> = T extends Date ? string : T extends (infer U)[] ? Jsonify<U>[] : T extends object ? { [K in keyof T]: Jsonify<T[K]> } : T;
  return JSON.parse(JSON.stringify(model)) as Jsonify<typeof model>;
}
