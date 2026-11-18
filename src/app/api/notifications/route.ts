import { connection } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listNotifications, markNotifications, notificationActor, NotificationError, preferences, savePreferences, type NotificationActor } from "@/lib/notifications-repository";
import { emailCapability } from "@/lib/notifications-email";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
const response = (value: unknown, status = 200) => Response.json(value, { status, headers });
async function actor(request: Request): Promise<NotificationActor> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new NotificationError("Войдите в систему.", 401);
  const actor = { id: session.user.id, sessionId: session.session.id };
  await notificationActor(prisma, actor); return actor;
}
function failure(error: unknown) {
  if (error instanceof NotificationError) return response({ error: error.message }, error.status);
  console.error("notifications.operation_failed");
  return response({ error: "Не удалось обновить уведомления. Повторим автоматически." }, 503);
}
export async function GET(request: Request) {
  await connection();
  try {
    const a = await actor(request), params = new URL(request.url).searchParams;
    if ([...params.keys()].some(k => !["view", "before"].includes(k) || params.getAll(k).length !== 1)) throw new NotificationError("Некорректные параметры.");
    if (params.get("view") === "settings") {
      const user = await notificationActor(prisma, a);
      return response({ ...await preferences(prisma, user.id), ...emailCapability(user) });
    }
    if (params.has("view")) throw new NotificationError("Неизвестный раздел.");
    const before = params.get("before");
    if (before !== null && !/^[1-9]\d{0,9}$/.test(before)) throw new NotificationError("Некорректный курсор.");
    return response(await listNotifications(prisma, a, before ? Number(before) : undefined));
  } catch (e) { return failure(e); }
}
export async function POST(request: Request) {
  await connection();
  try {
    if (request.headers.get("origin") !== new URL(process.env.BETTER_AUTH_URL!).origin || request.headers.get("sec-fetch-site") === "cross-site") throw new NotificationError("Источник запроса не разрешён.", 403);
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new NotificationError("Требуется JSON.", 415);
    await actor(request);
    const reader = request.body?.getReader(); if (!reader) throw new NotificationError("Пустой запрос.");
    const chunks: Uint8Array[] = []; let size = 0;
    const timer = setTimeout(() => { void reader.cancel(); }, 10000);
    try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > 4096) { await reader.cancel(); throw new NotificationError("Запрос слишком большой.", 413); } chunks.push(chunk.value); } }
    finally { clearTimeout(timer); reader.releaseLock(); }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new NotificationError("Некорректный JSON."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new NotificationError("Некорректная команда.");
    const a = await actor(request);
    if (["READ", "READ_ALL"].includes(body.operation)) {
      if (Object.keys(body).some(k => !["operation", "boundary"].includes(k))) throw new NotificationError("Некорректные поля.");
      await markNotifications(prisma, a, body.boundary, body.operation === "READ_ALL");
    } else if (body.operation === "SETTINGS") {
      if (Object.keys(body).some(k => !["operation", "optionalCategories", "emailCategories", "personalEmail"].includes(k))) throw new NotificationError("Некорректные поля.");
      await savePreferences(prisma, a, body);
    } else throw new NotificationError("Неизвестная команда.");
    return response({ ok: true });
  } catch (e) { return failure(e); }
}
