import "server-only";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { notificationActor, NotificationError, type NotificationActor } from "./notifications-repository.ts";
import { parseDashboardLayout } from "./dashboard-layout.ts";

export async function dashboardActor(db: PrismaClient, actor: NotificationActor) {
  const user = await notificationActor(db, actor);
  if (user.role !== "STUDENT") throw new NotificationError("Главная студента недоступна для этой роли.", 403);
  return { ...actor, role: user.role };
}
export async function saveDashboardLayout(db: PrismaClient, actor: NotificationActor, input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new NotificationError("Некорректные настройки.");
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some(key => !["layout", "version"].includes(key)) || !Number.isSafeInteger(body.version) || (body.version as number) < 0 || (body.version as number) >= 2147483647) throw new NotificationError("Некорректные поля настроек.");
  let layout;
  try { layout = parseDashboardLayout(body.layout); } catch (error) { throw new NotificationError((error as Error).message); }
  const version = body.version as number;
  return db.$transaction(async tx => {
    const user = await notificationActor(tx, actor);
    if (user.role !== "STUDENT") throw new NotificationError("Доступ закрыт.", 403);
    if (version === 0) {
      try { await tx.userPreferences.create({ data: { userId: user.id, dashboardLayoutJson: JSON.stringify(layout) } }); }
      catch (error) { if ((error as { code?: string }).code === "P2002") throw new NotificationError("Настройки изменились в другой вкладке. Обновите страницу и повторите выбор.", 409);throw error; }
    } else {
      const updated = await tx.userPreferences.updateMany({ where: { userId: user.id, version }, data: { dashboardLayoutJson: JSON.stringify(layout), version: { increment: 1 } } });
      if (!updated.count) throw new NotificationError("Настройки изменились в другой вкладке. Обновите страницу и повторите выбор.", 409);
    }
    return { layout, layoutVersion: version + 1 };
  });
}
