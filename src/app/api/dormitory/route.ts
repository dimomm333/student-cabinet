import { connection } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { dormActor, dormDocumentScope, dormRepairScope } from "@/lib/dormitory-access";
import { executeDormCommand } from "@/lib/dormitory-command";
import { DormError } from "@/lib/dormitory-shared";
import { ServiceError } from "@/lib/services-catalog";
import { readServiceBytes } from "@/lib/services-upload";
import { digest, localServiceStorage, MAX_SERVICE_FILE, MAX_SERVICE_PDF, prepareServiceFile } from "@/lib/services-storage";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
async function sessionActor(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new DormError("Войдите в систему.", 401);
  return { id: session.user.id, sessionId: session.session.id };
}
function errorResponse(error: unknown) {
  if (error instanceof DormError || error instanceof ServiceError) return Response.json({ error: error.message }, { status: error.status, headers });
  console.error("dormitory.file_operation_failed");
  return Response.json({ error: "Файл временно недоступен." }, { status: 503, headers });
}
export async function GET(request: Request) {
  await connection();
  try {
    const actor = await sessionActor(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id || !/^[\w-]{1,128}$/.test(id)) throw new DormError("Файл недоступен.", 404);
    const doc = await prisma.$transaction(async tx => {
      const user = await dormActor(tx, actor);
      return tx.dormFile.findFirst({ where: { id, OR: [
        { repair: dormRepairScope(user) }, { document: dormDocumentScope(user) },
      ] } });
    });
    if (!doc) throw new DormError("Файл недоступен.", 404);
    const bytes = await localServiceStorage().get(doc.key);
    if (bytes.length !== doc.size || digest(bytes) !== doc.sha256) throw new DormError("Файл недоступен.", 404);
    const ext = doc.mime === "application/pdf" ? "pdf" : doc.mime === "image/png" ? "png" : "jpg";
    return new Response(new Uint8Array(bytes), { headers: {
      ...headers, "Content-Type": doc.mime, "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": `attachment; filename="document.${ext}"; filename*=UTF-8''${encodeURIComponent(doc.name).replaceAll("'", "%27").replaceAll("(", "%28").replaceAll(")", "%29")}`,
      "Content-Length": String(bytes.length),
    } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  await connection();
  try {
    if (request.headers.get("origin") !== new URL(process.env.BETTER_AUTH_URL!).origin || request.headers.get("sec-fetch-site") === "cross-site") {
      throw new DormError("Источник запроса не разрешён.", 403);
    }
    const actor = await sessionActor(request);
    const user = await dormActor(prisma, actor);
    const params = new URL(request.url).searchParams;
    const action = params.get("action"), key = params.get("key") ?? "";
    const allowed = action === "REPAIR_FILE" ? ["id", "version"] : action === "DOCUMENT" ? ["dormitoryId", "placementId", "title", "kind"] : [];
    if (!allowed.length || !/^[\w-]{16,100}$/.test(key) ||
      [...params].some(([k]) => !["action", "key"].includes(k) || params.getAll(k).length > 1)) {
      throw new DormError("Некорректный запрос.");
    }
    const metadata = request.headers.get("x-dorm-fields") ?? "";
    const form = new URLSearchParams(metadata);
    if (metadata.length > 4000 || [...form].some(([k, v]) => !allowed.includes(k) || v.length > 200 || form.getAll(k).length > 1)) {
      throw new DormError("Некорректные параметры файла.");
    }
    const fields = Object.fromEntries(allowed.map(name => [name, form.get(name) ?? ""]));
    if (action === "REPAIR_FILE") {
      if (!await prisma.dormRepair.count({ where: { id: fields.id, ...dormRepairScope(user) } })) throw new DormError("Заявка недоступна.", 404);
    } else if (action === "DOCUMENT") {
      if (!await prisma.dormGrant.count({ where: { dormitoryId: fields.dormitoryId, userId: user.id, permission: "DOCUMENTS", active: true } })) {
        throw new DormError("Документы недоступны.", 403);
      }
    } else throw new DormError("Некорректный запрос.");
    const mime = request.headers.get("content-type") ?? "";
    const permitted = action === "REPAIR_FILE" ? ["image/jpeg", "image/png"] : ["application/pdf", "image/jpeg", "image/png"];
    if (!permitted.includes(mime)) throw new DormError("Недопустимый формат файла.", 415);
    let name: string;
    try { name = decodeURIComponent(request.headers.get("x-file-name") ?? ""); }
    catch { throw new DormError("Некорректное имя файла."); }
    const { bytes, ...file } = await prepareServiceFile(
      await readServiceBytes(request, mime === "application/pdf" ? MAX_SERVICE_PDF : MAX_SERVICE_FILE), name, mime,
    );
    const storage = localServiceStorage();
    await storage.put(file.key, bytes);
    try {
      const result = await executeDormCommand(prisma, actor, { action, key, fields, file });
      if (result.replayed) await storage.remove(file.key);
      return Response.json({ ok: true }, { headers });
    } catch (error) {
      if (!await prisma.dormFile.count({ where: { key: file.key } })) await storage.remove(file.key).catch(() => {});
      throw error;
    }
  } catch (error) { return errorResponse(error); }
}
