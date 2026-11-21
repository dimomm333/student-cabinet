import { connection } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ServiceError } from "@/lib/services-catalog";
import { changePass, ownPass, passHistory, verifyPass } from "@/lib/student-passes";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" };
async function actor(request: Request) {
  await connection();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new ServiceError("Войдите в систему.", 401);
  if (new URL(request.url).search) throw new ServiceError("Параметры URL не поддерживаются.");
  return { id: session.user.id, sessionId: session.session.id };
}
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers });
function failure(error: unknown) {
  if (error instanceof ServiceError) return reply({ error: error.message }, error.status);
  if (["P2002", "P2034"].includes((error as { code?: string })?.code ?? "")) return reply({ error: "Данные изменились. Обновите историю." }, 409);
  return reply({ error: "Операция недоступна. Повторите попытку." }, 503);
}
export async function GET(request: Request) {
  try { return reply(await ownPass(prisma, await actor(request))); } catch (error) { return failure(error); }
}
async function readCommand(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new ServiceError("Требуется JSON.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new ServiceError("Пустой запрос.");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {});
  }, 10_000);
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > 4096) throw new ServiceError("Запрос слишком большой.", 413);
      chunks.push(chunk.value);
    }
  } finally { clearTimeout(timeout); await reader.cancel().catch(() => {}); reader.releaseLock(); }
  if (timedOut) throw new ServiceError("Запрос не получен вовремя.", 408);
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (data && typeof data === "object" && !Array.isArray(data)) return data;
  } catch { /* report a generic validation error */ }
  throw new ServiceError("Некорректный запрос.");
}
export async function POST(request: Request) {
  try {
    const user = await actor(request);
    if (request.headers.get("origin") !== new URL(process.env.BETTER_AUTH_URL!).origin || request.headers.get("sec-fetch-site") === "cross-site") throw new ServiceError("Источник запроса не разрешён.", 403);
    const body = await readCommand(request);
    const { action, email, expected, reason, requestId, token } = body;
    const only = (...keys: string[]) => Object.keys(body).every(k => k === "action" || keys.includes(k));
    if (action === "verify" && only("token") && typeof token === "string") return reply(await verifyPass(prisma, user, token));
    if (typeof email !== "string" || !email.trim() || email.length > 320) throw new ServiceError("Укажите университетскую почту студента.");
    const address = email.trim().toLowerCase();
    if (action === "history" && only("email")) return reply(await passHistory(prisma, user, address));
    if (expected !== null && !(typeof expected === "number" && Number.isSafeInteger(expected) && expected > 0)) throw new ServiceError("Откройте историю студента.");
    if (action === "issue" && only("email", "expected")) return reply(await changePass(prisma, user, { action, email: address, expected }));
    if (action === "revoke" && typeof reason === "string" && only("email", "expected", "reason")) return reply(await changePass(prisma, user, { action, email: address, expected, reason }));
    if (action === "replace" && typeof reason === "string" && typeof requestId === "string" && requestId && only("email", "expected", "reason", "requestId")) {
      return reply(await changePass(prisma, user, { action, email: address, expected, reason, requestId }));
    }
    throw new ServiceError("Некорректные параметры операции.");
  } catch (error) { return failure(error); }
}
