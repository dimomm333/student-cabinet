"use server";
import { headers } from "next/headers";
import { requireRole } from "@/lib/access";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { publishAnnouncement } from "@/lib/announcements";
import { NotificationError } from "@/lib/notifications-repository";
export async function publishNews(_state: { success: boolean; message: string }, form: FormData) {
  await requireRole("ADMIN");
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { success: false, message: "Сессия завершена." };
  try {
    await publishAnnouncement(prisma, { id: session.user.id, sessionId: session.session.id }, { requestId: String(form.get("requestId") ?? ""), title: String(form.get("title") ?? ""), content: String(form.get("content") ?? ""), departmentId: String(form.get("departmentId") ?? "") || null });
    return { success: true, message: "Объявление опубликовано. Уведомления созданы для получателей." };
  } catch (e) {
    return { success: false, message: e instanceof NotificationError ? e.message : "Не удалось опубликовать объявление. Повторите запрос." };
  }
}
