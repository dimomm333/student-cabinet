"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isSessionWithinLifetime } from "@/lib/session-policy";
import { BrsError } from "@/lib/brs-repository";
import { DeaneryAccessDenied } from "@/lib/deanery-repository";
import { executePhysicalCommand } from "@/lib/physical-education-commands";

type FormState = { error?: string; message?: string };

export async function physicalAction(_state: FormState, form: FormData): Promise<FormState> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session || !isSessionWithinLifetime(session.session)) return { error: "Сессия завершена. Войдите снова." };
    const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, role: true } });
    if (!user) return { error: "Сессия завершена. Войдите снова." };
    const actor = { ...user, sessionId: session.session.id };
    const fields: Record<string, string[]> = Object.create(null);
    for (const [key, value] of form) {
      if (key.startsWith("$ACTION")) continue;
      if (typeof value !== "string" || value.length > 1000 || key.length > 160) return { error: "Некорректные данные формы." };
      (fields[key] ??= []).push(value);
    }
    const requestId = fields.requestId?.[0] ?? "", operation = fields.operation?.[0] ?? "";
    await executePhysicalCommand(prisma, actor, { requestId, operation, fields });
    for (const path of ["/dashboard", "/dashboard/sports", "/dashboard/schedule", "/dashboard/grades", "/dashboard/session",
      "/teacher/sports", "/teacher/schedule", "/teacher/grades", "/teacher/session", "/admin/sports", "/deanery/sports",
      "/deanery/grades", "/deanery/session", "/deanery/schedule", "/dashboard/notifications"]) revalidatePath(path);
    return { message: "Сохранено." };
  } catch (error) {
    if (error instanceof BrsError) return { error: error.message };
    if (error instanceof DeaneryAccessDenied) return { error: "Объект вне назначенных подразделений." };
    console.error("physical_education.operation_failed", error instanceof Error ? error.name : "unknown");
    return { error: "Не удалось сохранить изменения. Обновите страницу и повторите." };
  }
}
