import { connection } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { clearanceContext, clearanceDetail, downloadClearance, executeClearanceCommand, listClearances } from "@/lib/clearance-repository";
import { ClearanceError } from "@/lib/clearance-shared";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
function failure(e: unknown) { if (!(e instanceof ClearanceError)) console.error("clearance.operation_failed"); return json({ error: e instanceof ClearanceError ? e.message : "Обходной лист временно недоступен. Повторите попытку." }, e instanceof ClearanceError ? e.status : 503); }
async function actor(request: Request) { const s = await auth.api.getSession({ headers: request.headers }); if (!s) throw new ClearanceError("Войдите в систему.", 401); return { id: s.user.id, sessionId: s.session.id }; }
export async function GET(request: Request) {
  await connection();
  try {
    const a = await actor(request), p = new URL(request.url).searchParams;
    if ([...p.keys()].some(k => !["view", "id", "q", "page", "status", "reason", "departmentId", "group"].includes(k) || p.getAll(k).length !== 1 || p.get(k)!.length > 200)) throw new ClearanceError("Некорректные параметры.");
    const view = p.get("view") ?? "list", page = Number(p.get("page") ?? 0);
    if (view === "context") return json(await clearanceContext(prisma, a, p.get("q") ?? "", page));
    if (view === "detail") return json(await clearanceDetail(prisma, a, p.get("id") ?? "", page));
    if (view === "pdf") { const f = await downloadClearance(prisma, a, p.get("id") ?? ""); return new Response(f.bytes, { headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="clearance.pdf"; filename*=UTF-8''${encodeURIComponent(f.number + ".pdf")}`, "Content-Length": String(f.bytes.length), "Content-Security-Policy": "default-src 'none'; sandbox" } }); }
    if (view !== "list") throw new ClearanceError("Неизвестное представление.");
    return json(await listClearances(prisma, a, { page, q: p.get("q") ?? undefined, status: p.get("status") ?? undefined, reason: p.get("reason") ?? undefined, departmentId: p.get("departmentId") ?? undefined, group: p.get("group") ?? undefined }));
  } catch (e) { return failure(e); }
}
export async function POST(request: Request) {
  await connection();
  try {
    if (request.headers.get("origin") !== new URL(process.env.BETTER_AUTH_URL!).origin || request.headers.get("sec-fetch-site") === "cross-site") throw new ClearanceError("Источник запроса не разрешён.", 403);
    const a = await actor(request);
    if (request.headers.get("content-type")?.split(";")[0] !== "application/json") throw new ClearanceError("Ожидается JSON.", 415);
    const reader = request.body?.getReader(); if (!reader) throw new ClearanceError("Пустая команда.");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const chunks: Uint8Array[] = []; let size = 0;
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { void reader.cancel(); reject(new ClearanceError("Время отправки истекло.", 408)); }, 15000); });
      for (;;) { const part = await Promise.race([reader.read(), timeout]); if (part.done) break; size += part.value.length; if (size > 32768) { await reader.cancel(); throw new ClearanceError("Команда слишком большая.", 413); } chunks.push(part.value); }
      let body: unknown; try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new ClearanceError("Некорректный JSON."); }
      return json(await executeClearanceCommand(prisma, a, body));
    } finally { if (timer) clearTimeout(timer); reader.releaseLock(); }
  } catch (e) { return failure(e); }
}
