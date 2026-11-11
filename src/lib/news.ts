import "server-only";
import { prisma } from "./prisma";

export async function getLatestNews() {
  return prisma.news.findMany({
    where: { publishedAt: { lte: new Date() } },
    orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
    take: 3,
    select: { id: true, title: true, content: true, publishedAt: true },
  });
}
