"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { DeaneryAccessDenied } from "@/lib/deanery-repository";
import { ConsultationError, executeConsultationCommand } from "@/lib/consultations-repository";

export type ConsultationActionState = { success: boolean; message: string };

export async function saveConsultation(_previous: ConsultationActionState, form: FormData): Promise<ConsultationActionState> {
  const actor = await requireRole("DEANERY_STAFF");
  const text = (key: string) => {
    const value = form.get(key);
    return typeof value === "string" && value.length <= 128 ? value : "";
  };
  const operation = text("operation");
  try {
    await executeConsultationCommand(prisma, actor, {
      operation, id: text("id"), version: Number(text("version")),
      teacherId: text("teacherId"), disciplineId: text("disciplineId"), buildingId: text("buildingId"), roomId: text("roomId"),
      groupIds: form.getAll("groupIds").map(value => typeof value === "string" && value.length <= 128 ? value : ""),
      date: text("date"), start: text("start"), end: text("end"),
    });
    for (const path of ["/deanery/consultations", "/dashboard/consultations", "/teacher/consultations"]) revalidatePath(path);
    return { success: true, message: operation === "cancel" ? "Консультация отменена." : "Консультация сохранена." };
  } catch (error) {
    if (error instanceof ConsultationError) return { success: false, message: error.message };
    if (error instanceof DeaneryAccessDenied) return { success: false, message: "Консультация или группа вне ваших полномочий." };
    console.error("consultations.save_failed");
    return { success: false, message: "Не удалось сохранить изменения. Обновите страницу и повторите попытку." };
  }
}
