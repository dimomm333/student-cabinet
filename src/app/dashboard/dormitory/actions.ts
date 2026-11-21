"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { executeDormCommand } from "@/lib/dormitory-command";
import { DormError, type DormAction } from "@/lib/dormitory-shared";

export async function runDormAction(_previous: { ok: boolean; message: string }, form: FormData) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, message: "Сессия завершена. Войдите снова." };
  const action = String(form.get("dormAction") ?? "") as DormAction;
  if (action === "DOCUMENT" || action === "REPAIR_FILE") return { ok: false, message: "Воспользуйтесь формой загрузки файла." };
  const fields = Object.fromEntries([...form].filter(([key, value]) => key !== "dormAction" && key !== "key" && !key.startsWith("$ACTION") && typeof value === "string")) as Record<string, string>;
  try {
    await executeDormCommand(prisma, { id: session.user.id, sessionId: session.session.id }, { action, key: String(form.get("key") ?? ""), fields });
    for (const path of ["/dashboard/dormitory", "/admin/dormitory", "/staff/dormitory", "/dashboard/profile"]) revalidatePath(path);
    return { ok: true, message: "Сохранено." };
  } catch (error) {
    if (!(error instanceof DormError)) console.error("dormitory.command_failed");
    return { ok: false, message: error instanceof DormError ? error.message : "Операция не выполнена. Повторите попытку." };
  }
}
