import "server-only";
import { createHash } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { emitNotification, notificationActor, NotificationError, type NotificationActor } from "./notifications-repository.ts";

export async function publishAnnouncement(db: PrismaClient, actor: NotificationActor, input: { requestId: string; title: string; content: string; departmentId: string | null }) {
  if (!/^[\w-]{16,100}$/.test(input.requestId) || !input.title.trim() || input.title.length > 180 || !input.content.trim() || input.content.length > 10000) throw new NotificationError("Проверьте текст объявления.");
  const hash = createHash("sha256").update(JSON.stringify([input.title.trim(), input.content.trim(), input.departmentId])).digest("hex");
  return db.$transaction(async tx => {
    await tx.notificationWriteState.upsert({ where: { id: "announcements" }, create: { id: "announcements", version: 1 }, update: { version: { increment: 1 } } });
    const user = await notificationActor(tx, actor);
    if (user.role !== "ADMIN") throw new NotificationError("Публикация доступна администратору.", 403);
    if (input.departmentId && !await tx.academicDepartment.findUnique({ where: { id: input.departmentId } })) throw new NotificationError("Подразделение недоступно.");
    const key = `${user.id}:${input.requestId}`;
    const prior = await tx.news.findUnique({ where: { publicationKey: key } });
    if (prior) {
      const event = await tx.notificationEvent.findUnique({ where: { sourceKey: `news:${prior.id}:${hash}` } });
      if (!event) throw new NotificationError("Ключ использован для другого объявления.", 409);
      return prior;
    }
    const news = await tx.news.create({ data: { title: input.title.trim(), content: input.content.trim(), departmentId: input.departmentId, publicationKey: key, isDemo: false } });
    const students = await tx.user.findMany({ where: { role: "STUDENT", ...(input.departmentId ? { studentProfile: { group: { departmentId: input.departmentId } } } : {}) }, select: { id: true } });
    await emitNotification(tx, { sourceKey: `news:${news.id}:${hash}`, source: "NEWS", sourceId: news.id, type: "ANNOUNCEMENT_PUBLISHED", category: "ANNOUNCEMENTS", mandatory: false, title: "Опубликовано новое объявление", body: "Новое объявление доступно в личном кабинете.", recipients: students.map(s => ({ id: s.id, role: "STUDENT", href: `/dashboard/news?id=${encodeURIComponent(news.id)}`, departmentId: input.departmentId })) });
    await tx.notificationAudit.create({ data: { actorId: user.id, action: "PUBLISH_ANNOUNCEMENT" } });
    return news;
  }, { timeout: 30000 });
}
