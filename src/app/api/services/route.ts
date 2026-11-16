import { connection } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ServiceError, searchServices, configFor } from "@/lib/services-catalog";
import { executeServiceCommand, getServiceRequest, listServiceRequests, downloadServiceDocument, liveActor, getMilitaryRecord, visibleRequest, type ServiceActor, type ServiceCommand } from "@/lib/services-repository";
import { localServiceStorage, prepareServiceFile, MAX_SERVICE_FILE } from "@/lib/services-storage";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
const response = (data: unknown, status = 200) => Response.json(data, { status, headers });
async function actor(request: Request): Promise<ServiceActor> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new ServiceError("Войдите в систему.", 401);
  const actor = { id: session.user.id, sessionId: session.session.id };
  await liveActor(prisma, actor);
  return actor;
}
function errorResponse(error: unknown) {
  if (error instanceof ServiceError) return response({ error: error.message }, error.status);
  // Never print errors containing query parameters, fields, file paths or records.
  console.error("services.operation_failed");
  return response({ error: "Операция не выполнена. Повторите запрос с тем же requestId." }, 503);
}
function parameters(request: Request, allowed: string[]) {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => !allowed.includes(key) || params.getAll(key).length !== 1 || params.get(key)!.length > 1000)) throw new ServiceError("Некорректные параметры.");
  return params;
}
function pageNumber(value: string | null) { if (value !== null && !/^\d{1,5}$/.test(value)) throw new ServiceError("Некорректная страница."); return Number(value ?? 0); }
function dateFilter(value: string | null) { if (!value) return undefined; if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new ServiceError("Некорректная дата."); return new Date(value); }
export async function GET(request: Request) {
  await connection();
  try {
    const user = await actor(request);
    const p = parameters(request, ["view", "id", "q", "page", "code", "status", "from", "to", "studentId"]);
    const view = p.get("view") ?? "catalog", id = p.get("id") ?? "", page = pageNumber(p.get("page"));
    if (view === "catalog" || view === "suggest") {
      const routes = await prisma.serviceRoute.findMany({ where: { active: true, source: { groups: { some: { students: { some: { userId: user.id } } } } } }, select: { serviceCode: true, departmentId: true } });
      const definitions = await prisma.serviceDefinition.findMany({ select: { code: true, version: true, enabled: true } });
      const currentUser = await liveActor(prisma, user);
      return response({ items: searchServices(p.get("q") ?? "").slice(0, 50).map(({ service, score }) => {
        const enabled = definitions.some(d => d.code === service.code && d.version === service.version && d.enabled);
        const processingDepartmentId = routes.find(r => r.serviceCode === service.code)?.departmentId ?? null;
        return { ...service, score, enabled, available: currentUser.role === "STUDENT" && enabled && Boolean(processingDepartmentId), processingDepartmentId };
      }), generalAppealAllowed: true, generalAppealCode: "deanery-appeal" });
    }
    if (view === "request") return response(await getServiceRequest(prisma, user, id, page));
    if (view === "requests") return response(await listServiceRequests(prisma, user, { page, code: p.get("code") ?? undefined, status: p.get("status") ?? undefined, from: dateFilter(p.get("from")), to: p.get("to") ? new Date(dateFilter(p.get("to"))!.getTime() + 86400000 - 1) : undefined }));
    if (view === "events") {
      await liveActor(prisma, user);
      const events = await prisma.serviceEvent.findMany({ where: { recipientId: user.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50, skip: page * 50 });
      return response({ items: events.map(event => ({ ...event, href: `/dashboard/services?requestId=${encodeURIComponent(event.requestId)}` })), page, pageSize: 50, uiDelivery: "connected" });
    }
    if (view === "military") return response(await getMilitaryRecord(prisma, user, p.get("studentId") ?? user.id));
    if (view === "file") {
      const doc = await downloadServiceDocument(prisma, user, id, localServiceStorage());
      return new Response(new Uint8Array(doc.bytes), { headers: { ...headers, "Content-Type": doc.mime, "Content-Disposition": `attachment; filename="document.png"; filename*=UTF-8''${encodeURIComponent(doc.name)}`, "Content-Security-Policy": "default-src 'none'; sandbox", "Content-Length": String(doc.bytes.length) } });
    }
    throw new ServiceError("Неизвестная операция чтения.");
  } catch (error) { return errorResponse(error); }
}
async function readBytes(request: Request, limit: number) {
  if (Number(request.headers.get("content-length") ?? 0) > limit) throw new ServiceError("Запрос слишком большой.", 413);
  const reader = request.body?.getReader(); if (!reader) throw new ServiceError("Пустое тело запроса.");
  const chunks: Uint8Array[] = []; let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { void reader.cancel(); reject(new ServiceError("Время приёма запроса истекло.", 408)); }, 15000); });
    for (;;) { const part = await Promise.race([reader.read(), timeout]); if (part.done) break; size += part.value.length; if (size > limit) { await reader.cancel(); throw new ServiceError("Запрос слишком большой.", 413); } chunks.push(part.value); }
    return Buffer.concat(chunks);
  } finally { if (timer) clearTimeout(timer); reader.releaseLock(); }
}
const commandFields = new Set("operation requestId id version code fields confirmed confirmationHash status text clarificationFields clarificationSlots documentId slot kind".split(" "));
export async function POST(request: Request) {
  await connection();
  try {
    if (request.headers.get("origin") !== new URL(process.env.BETTER_AUTH_URL!).origin || request.headers.get("sec-fetch-site") === "cross-site") throw new ServiceError("Источник запроса не разрешён.", 403);
    const initialActor = await actor(request);
    const p = parameters(request, ["upload", "id", "version", "requestId", "slot", "kind"]);
    if (p.get("upload") === "1") {
      const id = p.get("id") ?? "";
      await visibleRequest(prisma, initialActor, id, true);
      const bytes = await readBytes(request, MAX_SERVICE_FILE);
      let filename: string;
      try { filename = decodeURIComponent(request.headers.get("x-file-name") ?? ""); } catch { throw new ServiceError("Некорректное имя файла."); }
      const file = await prepareServiceFile(bytes, filename, request.headers.get("content-type") ?? "");
      const user = await actor(request), storage = localServiceStorage();
      await storage.put(file.key, file.bytes);
      try {
        const result = await executeServiceCommand(prisma, user, { operation: "UPLOAD", id, version: Number(p.get("version")), requestId: p.get("requestId") ?? "", slot: p.get("slot") ?? "", kind: p.get("kind") ?? "" }, { key: file.key, name: file.name, mime: file.mime, size: file.size, sha256: file.sha256 });
        if (result.replayed) await storage.remove(file.key);
        return response(result);
      } catch (error) {
        // A receipt/DB commit may have succeeded before a connection failed.
        // Never remove a blob referenced by committed metadata.
        if (!await prisma.serviceDocument.findUnique({ where: { key: file.key }, select: { id: true } })) await storage.remove(file.key);
        throw error;
      }
    }
    if (p.size) throw new ServiceError("Параметры только для загрузки файла.");
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new ServiceError("Требуется JSON.", 415);
    let command: ServiceCommand;
    try { command = JSON.parse((await readBytes(request, 32768)).toString("utf8")); } catch (error) { if (error instanceof ServiceError) throw error; throw new ServiceError("Некорректный JSON."); }
    if (!command || typeof command !== "object" || Array.isArray(command) || Object.keys(command).some(key => !commandFields.has(key))) throw new ServiceError("Некорректные поля команды.");
    for (const key of ["operation", "requestId", "id", "code", "status", "text", "confirmationHash", "documentId", "slot", "kind"] as const) if (command[key] !== undefined && (typeof command[key] !== "string" || command[key]!.length > 4000)) throw new ServiceError("Некорректный тип поля.");
    if (command.code) configFor(command.code);
    return response(await executeServiceCommand(prisma, await actor(request), command));
  } catch (error) { return errorResponse(error); }
}
