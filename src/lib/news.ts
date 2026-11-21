import "server-only";
import { prisma } from "./prisma";

export async function getLatestNews() {
  return prisma.news.findMany({
    where: { publishedAt: { lte: new Date() }, departmentId: null, dormResidents: false, dormTargets: { none: {} } },
    orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
    take: 3,
    select: { id: true, title: true, content: true, publishedAt: true, category: true, isDemo: true },
  });
}
