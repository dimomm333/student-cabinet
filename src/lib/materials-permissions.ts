import "server-only";
import type { Prisma, Role } from "../generated/prisma/client.ts";
import { isSessionWithinLifetime } from "./session-policy.ts";
import { MaterialError } from "./materials-shared.ts";
export type MaterialDB = Prisma.TransactionClient;
export type MaterialActor = { id: string; sessionId: string };
export async function materialActor(db: MaterialDB, actor: MaterialActor) {
  const session = await db.session.findFirst({ where: { id: actor.sessionId, userId: actor.id }, include: { user: { select: { id: true, role: true } } } });
  if (!session || !isSessionWithinLifetime(session)) throw new MaterialError("Сессия завершена. Войдите снова.", 401);
  if (!["STUDENT", "TEACHER"].includes(session.user.role)) throw new MaterialError("Доступ к учебным материалам не предоставлен.", 403);
  return session.user;
}
// A student in a subgroup inherits parent materials, never sibling materials.
export async function materialStudentGroups(db: MaterialDB, userId: string) {
  const profile = await db.studentProfile.findUnique({ where: { userId }, select: { groupId: true } });
  const groups = await db.studyGroup.findMany({ select: { id: true, parentId: true } });
  return materialGroupAncestors(groups, profile?.groupId);
}
export function materialGroupAncestors(groups: { id: string; parentId: string | null }[], groupId?: string | null) {
  const ids: string[] = []; let id = groupId;
  while (id && !ids.includes(id)) { ids.push(id); id = groups.find(g => g.id === id)?.parentId; }
  return ids;
}
export async function materialScope(db: MaterialDB, user: { id: string; role: Role }): Promise<Prisma.LearningMaterialWhereInput> {
  if (user.role === "TEACHER") return { authorId: user.id, deletedAt: null };
  if (user.role !== "STUDENT") return { id: { in: [] } };
  return { status: "PUBLISHED", deletedAt: null, targets: { some: { groupId: { in: await materialStudentGroups(db, user.id) } } } };
}
export async function materialTeachingGroups(db: MaterialDB, teacherId: string, disciplineId: string, termId: string) {
  const user = await db.user.findUnique({ where: { id: teacherId }, select: { role: true } });
  if (user?.role !== "TEACHER") return [];
  const assignments = await db.teachingAssignment.findMany({ where: { teacherId, disciplineId, termId, isActive: true }, select: { groupId: true } });
  const ids = new Set(assignments.map(a => a.groupId));
  const groups = await db.studyGroup.findMany({ select: { id: true, parentId: true } });
  for (let changed = true; changed;) { changed = false; for (const g of groups) if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) { ids.add(g.id); changed = true; } }
  return [...ids];
}
export async function requireMaterialTeaching(db: MaterialDB, user: { id: string; role: Role }, disciplineId: string, termId: string, groups?: string[]) {
  if (user.role !== "TEACHER") throw new MaterialError("Изменение доступно преподавателю.", 403);
  const allowed = await materialTeachingGroups(db, user.id, disciplineId, termId);
  if (!allowed.length || groups?.some(id => !allowed.includes(id))) throw new MaterialError("Назначение на дисциплину или выбранные группы отсутствует либо отозвано.", 403);
  return allowed;
}
