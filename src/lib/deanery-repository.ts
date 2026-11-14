import "server-only";
import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { getPublicScheduleData } from "./schedule-repository.ts";
import type { ScheduleQuery } from "./schedule-calendar.ts";

// actor comes from requireRole on the server, never from request parameters.
// DB role and live assignments are also part of every resource query, so a
// revoked assignment or changed role cannot authorize a later operation.
type ScopeDB = Pick<PrismaClient, "user" | "academicDepartment" | "studyGroup" | "studentProfile">;
export type DeaneryActor = { id: string; role: string };
export class DeaneryAccessDenied extends Error { constructor() { super("Объект недоступен"); } }

function assignmentWhere(actor: DeaneryActor): Prisma.DeaneryDepartmentAssignmentWhereInput {
  return { userId: actor.id, staff: { user: { role: "DEANERY_STAFF" } } };
}
export function deaneryGroupWhere(actor: DeaneryActor): Prisma.StudyGroupWhereInput {
  return { department: { deaneryAssignments: { some: assignmentWhere(actor) } } };
}
export function deaneryStudentWhere(actor: DeaneryActor): Prisma.StudentProfileWhereInput {
  return { user: { role: "STUDENT" }, group: deaneryGroupWhere(actor) };
}
export async function getDeaneryContext(db: ScopeDB, actor: DeaneryActor) {
  if (actor.role !== "DEANERY_STAFF" || !await db.user.findFirst({ where: { id: actor.id, role: "DEANERY_STAFF" }, select: { id: true } })) throw new DeaneryAccessDenied();
  const departments = await db.academicDepartment.findMany({
    where: { deaneryAssignments: { some: assignmentWhere(actor) } },
    select: { id: true, faculty: true, name: true }, orderBy: [{ faculty: "asc" }, { name: "asc" }],
  });
  return { departments };
}
export async function requireDeaneryGroup(db: ScopeDB, actor: DeaneryActor, selector: { id?: string; slug?: string }) {
  await getDeaneryContext(db, actor);
  if (!selector.id && !selector.slug) throw new DeaneryAccessDenied();
  const group = await db.studyGroup.findFirst({ where: { AND: [deaneryGroupWhere(actor), selector] }, select: { id: true, slug: true, code: true } });
  if (!group) throw new DeaneryAccessDenied();
  return group;
}
export async function requireDeaneryStudent(db: ScopeDB, actor: DeaneryActor, studentId: string) {
  await getDeaneryContext(db, actor);
  const student = await db.studentProfile.findFirst({ where: { AND: [deaneryStudentWhere(actor), { userId: studentId }] }, select: {
    user: { select: { name: true, email: true } }, studentNumber: true, course: true,
    group: { select: { code: true } },
  } });
  if (!student) throw new DeaneryAccessDenied();
  return student;
}
export type DeaneryFilters = { departmentId?: string; groupId?: string; studentId?: string };
async function checkedFilters(db: ScopeDB, actor: DeaneryActor, filters: DeaneryFilters) {
  const context = await getDeaneryContext(db, actor);
  if (filters.departmentId && !context.departments.some(department => department.id === filters.departmentId)) throw new DeaneryAccessDenied();
  if (filters.groupId) await requireDeaneryGroup(db, actor, { id: filters.groupId });
  if (filters.studentId) await requireDeaneryStudent(db, actor, filters.studentId);
  return context;
}
export async function getDeaneryGroups(db: ScopeDB, actor: DeaneryActor, filters: DeaneryFilters = {}) {
  await checkedFilters(db, actor, filters);
  return db.studyGroup.findMany({ where: { AND: [deaneryGroupWhere(actor), { departmentId: filters.departmentId, id: filters.groupId }] },
    select: { id: true, slug: true, code: true, programme: true, course: true, isPublic: true, parentId: true,
      department: { select: { name: true, faculty: true } }, _count: { select: { students: { where: { user: { role: "STUDENT" } } } } } },
    orderBy: [{ code: "asc" }, { id: "asc" }], take: 201,
  });
}
export async function getDeaneryStudents(db: ScopeDB, actor: DeaneryActor, filters: DeaneryFilters = {}) {
  await checkedFilters(db, actor, filters);
  return db.studentProfile.findMany({ where: { AND: [deaneryStudentWhere(actor), { userId: filters.studentId, groupId: filters.groupId, group: { departmentId: filters.departmentId } }] },
    select: { userId: true, user: { select: { name: true, email: true } }, studentNumber: true, course: true, group: { select: { code: true } } },
    orderBy: [{ user: { name: "asc" } }, { userId: "asc" }], take: 201,
  });
}
export async function getDeaneryOverview(db: ScopeDB, actor: DeaneryActor) {
  const context = await getDeaneryContext(db, actor);
  const [groups, students] = await Promise.all([
    db.studyGroup.count({ where: deaneryGroupWhere(actor) }),
    db.studentProfile.count({ where: deaneryStudentWhere(actor) }),
  ]);
  return { ...context, groups, students };
}
export async function getDeanerySchedule(db: PrismaClient, actor: DeaneryActor, query: ScheduleQuery) {
  await getDeaneryContext(db, actor);
  if (query.selected) await requireDeaneryGroup(db, actor, { slug: query.selected });
  // Reuse the common reader and its publication boundary. A deanery role does
  // not unlock unpublished entries, private teachers or unrelated catalogues.
  const groups = await db.studyGroup.findMany({ where: { AND: [deaneryGroupWhere(actor), { isPublic: true }] },
    select: { slug: true, code: true, programme: true, parent: { select: { slug: true } }, department: { select: { name: true, faculty: true } } }, orderBy: { code: "asc" }, take: 500 });
  const allowed = new Set(groups.map(group => group.slug));
  if (query.selected && !allowed.has(query.selected)) throw new DeaneryAccessDenied();
  const allGroups = groups.map(group => ({ slug: group.slug, name: group.code, programme: group.programme,
    faculty: group.department?.faculty ?? null, department: group.department?.name ?? null,
    parentSlug: group.parent && allowed.has(group.parent.slug) ? group.parent.slug : null }));
  const result = await getPublicScheduleData(db, { ...query, view: "group" }, { allGroups, allTeachers: [] });
  return { ...result, days: result.days.map(day => ({ ...day, lessons: day.lessons.map(lesson => ({ ...lesson, groups: lesson.groups.filter(group => allowed.has(group.slug)) })) })) };
}
