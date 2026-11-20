import "server-only";
import type { Prisma, Role } from "../generated/prisma/client.ts";
import { isSessionWithinLifetime } from "./session-policy.ts";
import { ClearanceError } from "./clearance-shared.ts";
export type ClearanceDB = Prisma.TransactionClient;
export type ClearanceActor = { id: string; sessionId: string };
export type ClearanceUser = { id: string; name: string; role: Role };
export async function clearanceActor(db: ClearanceDB, actor: ClearanceActor) {
  const session = await db.session.findFirst({ where: { id: actor.sessionId, userId: actor.id }, include: { user: { select: { id: true, name: true, role: true } } } });
  if (!session || !isSessionWithinLifetime(session)) throw new ClearanceError("Сессия завершена. Войдите снова.", 401);
  if (session.user.role === "TEACHER") throw new ClearanceError("Доступ к обходным листам не предоставлен.", 403);
  return session.user;
}
export function clearanceDeaneryScope(userId: string): Prisma.ClearanceProcessWhereInput {
  return { academicDepartment: { deaneryAssignments: { some: { userId, staff: { user: { role: "DEANERY_STAFF" } } } } }, student: { role: "STUDENT", studentProfile: { group: { department: { deaneryAssignments: { some: { userId } } } } } } };
}
// Shared with inbox/email delivery, so revocation hides old notifications too.
export function clearanceScope(user: { id: string; role: Role }): Prisma.ClearanceProcessWhereInput {
  if (user.role === "STUDENT") return { studentId: user.id, status: { not: "DRAFT" } };
  if (user.role === "DEANERY_STAFF") return clearanceDeaneryScope(user.id);
  if (user.role === "ADMIN") return {};
  if (user.role === "TECHNICAL_STAFF") return { status: { not: "DRAFT" }, steps: { some: { isFinal: false, department: { active: true, grants: { some: { userId: user.id, active: true } } } } } };
  return { id: { in: [] } };
}
export function clearanceStepScope(user: ClearanceUser): Prisma.ClearanceStepWhereInput {
  return user.role === "TECHNICAL_STAFF" ? { isFinal: false, department: { active: true, grants: { some: { userId: user.id, active: true } } } } : {};
}
export async function requireClearanceManager(db: ClearanceDB, user: ClearanceUser, processId: string) {
  if (user.role !== "DEANERY_STAFF" || !await db.clearanceProcess.count({ where: { id: processId, ...clearanceDeaneryScope(user.id) } })) throw new ClearanceError("Обходной лист недоступен деканату.", 404);
}
