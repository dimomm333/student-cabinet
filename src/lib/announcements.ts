import "server-only";
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { emitNotification, notificationActor, NotificationError, type NotificationActor } from "./notifications-repository.ts";
import { dormGrantScope } from "./dormitory-access.ts";

type AnnouncementInput = {
  requestId: string; title: string; content: string; departmentId: string | null;
  allResidents?: boolean; dormitoryIds?: string[]; buildingIds?: string[];
};

export async function publishAnnouncement(db: PrismaClient, actor: NotificationActor, input: AnnouncementInput) {
  if (!/^[\w-]{16,100}$/.test(input.requestId) || !input.title.trim() || input.title.length > 180 || !input.content.trim() || input.content.length > 10000) {
    throw new NotificationError("Проверьте текст объявления.");
  }
  const dormitoryIds = [...new Set(input.dormitoryIds)].sort(), buildingIds = [...new Set(input.buildingIds)].sort();
  const targeted = Boolean(input.allResidents || dormitoryIds.length || buildingIds.length);
  if (dormitoryIds.length + buildingIds.length > 100 || [...dormitoryIds, ...buildingIds].some(id => !/^[\w-]{1,128}$/.test(id)) ||
    targeted && input.departmentId || input.allResidents && (dormitoryIds.length || buildingIds.length)) {
    throw new NotificationError("Проверьте получателей объявления.");
  }
  const content = [input.title.trim(), input.content.trim(), input.departmentId];
  const hash = createHash("sha256").update(JSON.stringify(targeted ? [...content, Boolean(input.allResidents), dormitoryIds, buildingIds] : content)).digest("hex");
  return db.$transaction(async tx => {
    await tx.notificationWriteState.upsert({ where: { id: "announcements" }, create: { id: "announcements", version: 1 }, update: { version: { increment: 1 } } });
    const user = await notificationActor(tx, actor);
    if ((!targeted || input.allResidents) && user.role !== "ADMIN") throw new NotificationError("Публикация доступна администратору.", 403);
    if (input.departmentId && !await tx.academicDepartment.findUnique({ where: { id: input.departmentId } })) throw new NotificationError("Подразделение недоступно.");
    const scope = dormGrantScope(user, ["ANNOUNCEMENTS"]);
    const dorms = dormitoryIds.length ? await tx.dormitory.findMany({ where: { ...scope, id: { in: dormitoryIds }, archivedAt: null }, select: { id: true } }) : [];
    const buildings = buildingIds.length ? await tx.dormBuilding.findMany({ where: { id: { in: buildingIds }, dormitory: { ...scope, archivedAt: null } }, select: { id: true, dormitoryId: true } }) : [];
    if (dorms.length !== dormitoryIds.length || buildings.length !== buildingIds.length ||
      input.allResidents && await tx.dormitory.count({ where: { archivedAt: null, NOT: scope } })) {
      throw new NotificationError("Нет полномочий для выбранной аудитории.", 403);
    }
    const key = `${user.id}:${input.requestId}`;
    const prior = await tx.news.findUnique({ where: { publicationKey: key } });
    if (prior) {
      const event = await tx.notificationEvent.findUnique({ where: { sourceKey: `news:${prior.id}:${hash}` } });
      if (!event) throw new NotificationError("Ключ использован для другого объявления.", 409);
      return prior;
    }
    const targets = [
      ...dorms.map(dorm => ({ dormitoryId: dorm.id })),
      ...buildings.filter(b => !dormitoryIds.includes(b.dormitoryId)).map(b => ({ dormitoryId: b.dormitoryId, buildingId: b.id })),
    ];
    const news = await tx.news.create({ data: {
      title: input.title.trim(), content: input.content.trim(), departmentId: input.departmentId, publicationKey: key, isDemo: false,
      dormResidents: Boolean(input.allResidents), dormTargets: { create: targets },
    } });
    const currentResidents: Prisma.UserWhereInput = { dormPlacements: { some: {
      status: "ACTIVE",
      ...(input.allResidents ? {} : { bed: { room: { floor: { building: { OR: [
        { dormitoryId: { in: dormitoryIds } }, { id: { in: buildingIds } },
      ] } } } } }),
    } } };
    const students = await tx.user.findMany({
      where: { role: "STUDENT", ...(targeted ? currentResidents : input.departmentId ? { studentProfile: { group: { departmentId: input.departmentId } } } : {}) },
      select: { id: true },
    });
    await emitNotification(tx, {
      sourceKey: `news:${news.id}:${hash}`, source: "NEWS", sourceId: news.id, type: "ANNOUNCEMENT_PUBLISHED", category: "ANNOUNCEMENTS",
      mandatory: false, title: "Опубликовано новое объявление", body: "Новое объявление доступно в личном кабинете.",
      recipients: students.map(s => ({ id: s.id, role: "STUDENT", href: `/dashboard/news?id=${encodeURIComponent(news.id)}`, departmentId: input.departmentId })),
    });
    await tx.notificationAudit.create({ data: { actorId: user.id, action: "PUBLISH_ANNOUNCEMENT" } });
    if (targeted) await tx.dormAudit.create({ data: { actorId: user.id, targetId: news.id, action: "PUBLISH_ANNOUNCEMENT", detail: JSON.stringify({ all: input.allResidents, targets }) } });
    return news;
  }, { timeout: 30000 });
}
