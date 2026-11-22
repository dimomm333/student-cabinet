import "server-only";
import type { Prisma } from "../generated/prisma/client.ts";
import { BrsError, fail, type BrsActor } from "./brs-repository.ts";
import { deaneryGroupWhere } from "./deanery-repository.ts";
import { isSessionWithinLifetime } from "./session-policy.ts";
import { isRole } from "./roles.ts";

export const physicalGroupInclude = {
  direction: true, categories: true,
  plan: { include: { group: true, term: true, discipline: true } },
} satisfies Prisma.PeGroupInclude;

export type PhysicalGroup = Prisma.PeGroupGetPayload<{ include: typeof physicalGroupInclude }>;
export type PhysicalDB = Prisma.TransactionClient;

export async function physicalActor(db: PhysicalDB, actor: BrsActor, mutation = false) {
  if (!isRole(actor.role) || actor.role === "TECHNICAL_STAFF"
    || !await db.user.findFirst({ where: { id: actor.id, role: actor.role }, select: { id: true } })) {
    fail("Доступ к физкультуре закрыт.", 403);
  }
  if (mutation) {
    const session = actor.sessionId && await db.session.findFirst({ where: { id: actor.sessionId, userId: actor.id } });
    if (!session || !isSessionWithinLifetime(session)) throw new BrsError("Сессия завершена. Войдите снова.", 401);
  }
}

export function administrative(actor: BrsActor) {
  if (actor.role !== "ADMIN" && actor.role !== "DEANERY_STAFF") fail("Действие доступно администрации.", 403);
}

export function groupScopeFor(actor: BrsActor): Prisma.PeGroupWhereInput {
  if (actor.role === "DEANERY_STAFF") return { plan: { group: deaneryGroupWhere(actor) } };
  return {};
}

export async function teacherAssignments(db: PhysicalDB, groups: PhysicalGroup[], teacherId?: string) {
  if (!groups.length) return [];
  return db.teachingAssignment.findMany({
    where: { isActive: true, teacherId, teacher: { role: "TEACHER" },
      OR: groups.map(({ plan }) => ({ groupId: plan.groupId, termId: plan.termId, disciplineId: plan.disciplineId })) },
    select: { id: true, teacherId: true, groupId: true, teacher: { select: { name: true } } },
    orderBy: { confirmedAt: "desc" },
  });
}

export async function groupFor(db: PhysicalDB, actor: BrsActor, id: string) {
  const group = await db.peGroup.findFirst({ where: { id, ...groupScopeFor(actor) }, include: physicalGroupInclude });
  if (!group) fail("Спортивная группа недоступна.", 404);
  if (actor.role === "TEACHER" && !(await teacherAssignments(db, [group], actor.id)).length) fail("Действующее учебное назначение отсутствует.", 403);
  return group;
}

export async function studentFor(db: PhysicalDB, actor: BrsActor, studentId: string) {
  if (actor.role === "STUDENT" && actor.id !== studentId) fail("Студент недоступен.", 403);
  const student = await db.studentProfile.findFirst({ where: { userId: studentId, user: { role: "STUDENT" },
    ...(actor.role === "DEANERY_STAFF" ? { group: deaneryGroupWhere(actor) } : {}) },
    include: { group: true } });
  if (!student) fail("Студент недоступен.", 403);
  return student;
}
