import "server-only";
import type { PrismaClient, Prisma } from "../generated/prisma/client.ts";
import { currentPlacement } from "./dormitory-access.ts";

export async function studentNewsScope(db: Prisma.TransactionClient, userId: string, now = new Date()): Promise<Prisma.NewsWhereInput> {
  const profile = await db.studentProfile.findUnique({ where: { userId }, select: { group: { select: { departmentId: true } } } });
  const placement = await db.dormPlacement.findFirst({ where: currentPlacement(userId), select: {
    bed: { select: { room: { select: { floor: { select: { building: { select: { dormitoryId: true, id: true } } } } } } } },
  } });
  const building = placement?.bed.room.floor.building;
  return { publishedAt: { lte: now }, OR: [
    { dormResidents: false, dormTargets: { none: {} }, OR: [{ departmentId: null }, { departmentId: profile?.group?.departmentId ?? "" }] },
    ...(building ? [
      { dormResidents: true },
      { dormTargets: { some: { dormitoryId: building.dormitoryId, OR: [{ buildingId: null }, { buildingId: building.id }] } } },
    ] : []),
  ] };
}
export async function getStudentHomeNews(db: PrismaClient, userId: string, now = new Date()) {
  return db.$transaction(async tx => tx.news.findMany({ where: { ...await studentNewsScope(tx, userId, now), isDemo: false },
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }], take: 3,
    select: { id: true, title: true, category: true, publishedAt: true } }));
}
