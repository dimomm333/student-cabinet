"use server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { publishAnnouncement } from "@/lib/announcements";
import { NotificationError } from "@/lib/notifications-repository";
export async function publishNews(_state: { success: boolean; message: string }, form: FormData) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { success: false, message: "Сессия завершена." };
  try {
    const audience = String(form.get("audience") ?? "academic");
    if (!["academic", "residents", "local"].includes(audience) ||
      audience === "local" && !form.getAll("dormitoryId").length && !form.getAll("buildingId").length) {
      throw new NotificationError("Выберите получателей объявления.");
    }
    await publishAnnouncement(prisma, { id: session.user.id, sessionId: session.session.id }, {
      requestId: String(form.get("requestId") ?? ""), title: String(form.get("title") ?? ""), content: String(form.get("content") ?? ""),
      departmentId: audience === "academic" ? String(form.get("departmentId") ?? "") || null : null,
      allResidents: audience === "residents",
      dormitoryIds: audience === "local" ? form.getAll("dormitoryId").map(String) : [],
      buildingIds: audience === "local" ? form.getAll("buildingId").map(String) : [],
    });
    return { success: true, message: "Объявление опубликовано. Уведомления созданы для получателей." };
  } catch (e) {
    return { success: false, message: e instanceof NotificationError ? e.message : "Не удалось опубликовать объявление. Повторите запрос." };
  }
}
