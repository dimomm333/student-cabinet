import { connection } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { dashboardActor, saveDashboardLayout } from "@/lib/dashboard-settings";
import { getStudentHomeData } from "@/lib/student-home";
import { NotificationError } from "@/lib/notifications-repository";
import { BrsError } from "@/lib/brs-repository";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
const response = (value: unknown, status = 200) => Response.json(value, { status, headers });
async function actor(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new NotificationError("Войдите в систему.", 401);
  return dashboardActor(prisma, { id: session.user.id, sessionId: session.session.id });
}
function failure(error: unknown) {
  if (error instanceof NotificationError || error instanceof BrsError) return response({ error: error.message }, error.status);
  console.error("dashboard.operation_failed");
  return response({ error: "Не удалось обновить главную. Повторите попытку." }, 503);
}
export async function GET(request: Request) {
  await connection();
  try {
    const user = await actor(request);
    if (new URL(request.url).search) throw new NotificationError("Параметры главной не поддерживаются.");
    return response(await getStudentHomeData(prisma, user));
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  await connection();
  try {
    if (request.headers.get("origin") !== new URL(process.env.BETTER_AUTH_URL!).origin || request.headers.get("sec-fetch-site") === "cross-site") throw new NotificationError("Источник запроса не разрешён.", 403);
    await actor(request);
    if (new URL(request.url).search) throw new NotificationError("Параметры главной не поддерживаются.");
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new NotificationError("Требуется JSON.", 415);
    const reader = request.body?.getReader();if (!reader) throw new NotificationError("Пустой запрос.");
    const chunks: Uint8Array[] = [];let size = 0;
    const timer = setTimeout(() => { void reader.cancel(); }, 10000);
    try { for (;;) { const item = await reader.read();if (item.done) break;size += item.value.length;if (size > 2048) throw new NotificationError("Запрос слишком большой.", 413);chunks.push(item.value); } }
    finally { clearTimeout(timer);await reader.cancel().catch(() => {});reader.releaseLock(); }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new NotificationError("Некорректный JSON."); }
    return response(await saveDashboardLayout(prisma, await actor(request), body));
  } catch (error) { return failure(error); }
}
