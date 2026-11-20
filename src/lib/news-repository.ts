import "server-only";
import type { PrismaClient, Prisma } from "../generated/prisma/client.ts";

export async function studentNewsScope(db: PrismaClient, userId: string, now = new Date()): Promise<Prisma.NewsWhereInput> {
  const profile = await db.studentProfile.findUnique({ where: { userId }, select: { group: { select: { departmentId: true } } } });
  return { publishedAt: { lte: now }, OR: [{ departmentId: null }, { departmentId: profile?.group?.departmentId ?? "" }] };
}
export async function getStudentHomeNews(db: PrismaClient, userId: string, now = new Date()) {
  return db.news.findMany({ where: { ...await studentNewsScope(db, userId, now), isDemo: false },
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }], take: 3,
    select: { id: true, title: true, category: true, publishedAt: true } });
}
