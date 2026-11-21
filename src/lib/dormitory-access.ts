import "server-only";
import type { DormPermission, Prisma, Role } from "../generated/prisma/client.ts";
import { DormError } from "./dormitory-shared.ts";
import { isSessionWithinLifetime } from "./session-policy.ts";

export type DormDB = Prisma.TransactionClient;
export type DormActor = { id: string; sessionId: string };
export type DormUser = { id: string; role: Role };
export const dormStaffRole = (role: Role) => role === "ADMIN" || role === "TECHNICAL_STAFF";

export async function dormActor(db: DormDB, actor: DormActor): Promise<DormUser> {
  const session = await db.session.findFirst({
    where: { id: actor.sessionId, userId: actor.id },
    include: { user: { select: { id: true, role: true } } },
  });
  if (!session || !isSessionWithinLifetime(session)) throw new DormError("Сессия завершена. Войдите снова.", 401);
  if (session.user.role !== "STUDENT" && !dormStaffRole(session.user.role)) throw new DormError("Доступ к общежитию не предоставлен.", 403);
  return session.user;
}

export function dormGrantScope(user: DormUser, permissions: DormPermission[]): Prisma.DormitoryWhereInput {
  if (!dormStaffRole(user.role)) return { id: { in: [] } };
  return { grants: { some: { userId: user.id, active: true, permission: { in: permissions } } } };
}

export async function requireDormGrant(db: DormDB, user: DormUser, dormitoryId: string, ...permissions: DormPermission[]) {
  if (!await db.dormitory.count({ where: { id: dormitoryId, ...dormGrantScope(user, permissions) } })) {
    throw new DormError("Операция недоступна для этого общежития.", 403);
  }
}

export const dormLocation = {
  include: { floor: { include: { building: { include: { dormitory: true } } } }, block: true },
} as const;

export const placementLocation = { bed: { include: { room: dormLocation } } } as const;

export function currentPlacement(studentId: string): Prisma.DormPlacementWhereInput {
  return { studentId, status: "ACTIVE", student: { role: "STUDENT" } };
}

export function roomDormitory(room: { floor: { building: { dormitoryId: string } } }) {
  return room.floor.building.dormitoryId;
}

export function dormRepairScope(user: DormUser): Prisma.DormRepairWhereInput {
  if (user.role === "STUDENT") return { room: { beds: { some: { placements: { some: currentPlacement(user.id) } } } } };
  return { OR: [
    { room: { floor: { building: { dormitory: dormGrantScope(user, ["REPAIR"]) } } } },
    { assigneeId: user.id, room: { floor: { building: { dormitory: dormGrantScope(user, ["TECHNICIAN"]) } } } },
  ] };
}

export function dormDocumentScope(user: DormUser): Prisma.DormDocumentWhereInput {
  if (user.role === "STUDENT") return { archivedAt: null, OR: [
    { ownerId: user.id },
    { ownerId: null, dormitory: { buildings: { some: { floors: { some: { rooms: { some: {
      beds: { some: { placements: { some: currentPlacement(user.id) } } },
    } } } } } } } },
  ] };
  return { dormitory: dormGrantScope(user, ["DOCUMENTS"]) };
}
