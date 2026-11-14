"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { DeaneryAccessDenied } from "@/lib/deanery-repository";
import { executeScheduleCommand, ScheduleEditError, type ScheduleCommand } from "@/lib/schedule-editor-repository";

export type ScheduleActionState = { success: boolean; message: string; saved?: string };
export async function saveSchedule(_previous: ScheduleActionState, form: FormData): Promise<ScheduleActionState> {
  const actor = await requireRole("DEANERY_STAFF");
  const text = (name: string) => { const value = form.get(name); return typeof value === "string" && value.length <= 200 ? value : ""; };
  const many = (name: string) => form.getAll(name).filter((value): value is string => typeof value === "string" && value.length <= 128);
  try {
    const result = await executeScheduleCommand(prisma, actor, {
      operation: text("operation") as ScheduleCommand["operation"], entryId: text("entryId") || undefined, exceptionId: text("exceptionId") || undefined,
      version: Number(text("version")), sourceDate: text("sourceDate"), date: text("date"),
      groupIds: many("groupIds"), teacherIds: many("teacherIds"), disciplineId: text("disciplineId"), roomId: text("roomId"), termId: text("termId"),
      dayOfWeek: Number(text("dayOfWeek")), start: text("start"), end: text("end"), kind: text("kind"), weekPattern: text("weekPattern") || "EVERY", isPublished: form.get("isPublished") === "on", confirmed: form.get("confirm") === "on",
    });
    for (const path of ["/deanery/schedule", "/schedule", "/dashboard/schedule", "/teacher/schedule", "/dashboard"]) revalidatePath(path);
    return { success: true, message: result.message, saved: result.objectId };
  } catch (error) {
    if (error instanceof ScheduleEditError) return { success: false, message: error.message };
    if (error instanceof DeaneryAccessDenied) return { success: false, message: "Полномочия изменились. Обновите страницу; доступ к изменению закрыт." };
    console.error("schedule.edit_failed");
    return { success: false, message: "Не удалось сохранить расписание. Обновите страницу и повторите попытку." };
  }
}
