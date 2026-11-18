import "server-only";
import type { Prisma } from "../generated/prisma/client.ts";

// Pure scope shared by request operations, notification reads and email worker.
// The caller supplies a freshly authorized user; no role bypass is permitted.
export async function serviceProcessorScope(db: Prisma.TransactionClient, user: { id: string; role: string }, files = false, military = false): Promise<Prisma.ServiceRequestWhereInput> {
  if (!["DEANERY_STAFF", "TECHNICAL_STAFF", "ADMIN"].includes(user.role)) return { id: { in: [] } };
  const grants = await db.serviceGrant.findMany({ where: { userId: user.id, active: true, ...(files ? { readFiles: true } : {}), ...(military ? { readMilitary: true } : {}), ...(user.role === "DEANERY_STAFF" ? { department: { deaneryAssignments: { some: { userId: user.id } } } } : {}) } });
  const valid = grants.filter(grant => Boolean(grant.serviceCode) !== Boolean(grant.category));
  if (!valid.length) return { id: { in: [] } };
  return { OR: valid.map(grant => ({ departmentId: grant.departmentId, ...(grant.serviceCode ? { serviceCode: grant.serviceCode } : { category: grant.category }), ...(grant.readMilitary ? {} : { AND: [{ serviceCode: { not: "military-change" } }] }), OR: [{ assigneeId: null }, { assigneeId: user.id }] })) };
}
