"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { usefulAdminPath, usefulPath } from "@/lib/useful-catalog";
import { saveUsefulEntry, UsefulError } from "@/lib/useful-repository";

export async function saveEntry(id: string | null, _state: string, form: FormData) {
  await requireRole("ADMIN");

  let saved;
  try {
    saved = await saveUsefulEntry(prisma, id, form);
  } catch (error) {
    if (error instanceof UsefulError) return error.message;
    console.error("Не удалось сохранить запись справочника", error instanceof Error ? error.name : "unknown");
    return "Не удалось сохранить запись. Повторите попытку.";
  }

  revalidatePath(usefulPath);
  revalidatePath("/dashboard/mail");
  revalidatePath(usefulPath + "/[id]", "page");
  revalidatePath(usefulAdminPath);
  redirect(usefulAdminPath + "/" + saved.id + "?saved=1");
}
