import { connection } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { downloadMaterial, executeMaterialCommand, listMaterials, parseMaterialCommand } from "@/lib/materials-repository";
import { materialActor, requireMaterialTeaching } from "@/lib/materials-permissions";
import { MaterialError } from "@/lib/materials-shared";
import { materialDownload, receiveMaterialFile, removeMaterialBlob } from "@/lib/materials-storage";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
const response = (value: unknown, status = 200) => Response.json(value, { status, headers });
function failure(error: unknown) { return response({ error: error instanceof MaterialError ? error.message : "Материалы временно недоступны. Повторите попытку." }, error instanceof MaterialError ? error.status : 503); }
async function actor(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new MaterialError("Войдите в систему.", 401);
  const a = { id: session.user.id, sessionId: session.session.id }; await materialActor(prisma, a); return a;
}
export async function GET(request: Request) {
  await connection();
  try {
    const a = await actor(request), p = new URL(request.url).searchParams;
    if ([...p.keys()].some(k => !["termId", "disciplineId", "q", "page", "file", "category", "folderId", "materialId"].includes(k) || p.getAll(k).length !== 1 || p.get(k)!.length > 200)) throw new MaterialError("Некорректные параметры.");
    if (p.has("file")) {
      const file = await downloadMaterial(prisma, a, p.get("file")!);
      return new Response(materialDownload(file.key), { headers: { ...headers, "Content-Type": file.mime, "Content-Length": String(file.size), "Content-Disposition": `attachment; filename="material.${file.name.split(".").pop()!.toLowerCase()}"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, ch => "%" + ch.charCodeAt(0).toString(16))}`, "Content-Security-Policy": "default-src 'none'; sandbox" } });
    }
    return response(await listMaterials(prisma, a, { termId: p.get("termId") ?? undefined, disciplineId: p.get("disciplineId") ?? undefined, q: p.get("q") ?? undefined, page: Number(p.get("page") ?? 0), category: p.get("category") ?? undefined, folderId: p.get("folderId") ?? undefined, materialId: p.get("materialId") ?? undefined }));
  } catch (error) { return failure(error); }
}
async function commandBody(request: Request) {
  const reader = request.body?.getReader(); if (!reader) throw new MaterialError("Пустая команда.");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const chunks: Uint8Array[] = []; let size = 0;
    const timeout = new Promise<never>((_,reject) => { timer = setTimeout(() => { void reader.cancel(); reject(new MaterialError("Время приёма команды истекло.", 408)); }, 15000); });
    for (;;) { const part = await Promise.race([reader.read(), timeout]); if (part.done) break; size += part.value.length; if (size > 32768) { await reader.cancel(); throw new MaterialError("Команда слишком большая.", 413); } chunks.push(part.value); }
    try { return parseMaterialCommand(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch (error) { if (error instanceof MaterialError) throw error; throw new MaterialError("Некорректный JSON."); }
  } finally { if (timer) clearTimeout(timer); reader.releaseLock(); }
}
// Length-prefixed UTF-8 JSON followed by file bytes. Metadata belongs in the
// bounded body, so a normal Cyrillic description cannot overflow HTTP headers.
async function uploadBody(request: Request) {
  const reader = request.body?.getReader(); if (!reader) throw new MaterialError("Файл не получен.");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let buffer = Buffer.alloc(0);
  try {
    const timeout = new Promise<never>((_,reject) => { timer = setTimeout(() => { void reader.cancel(); reject(new MaterialError("Время приёма параметров истекло.", 408)); }, 15000); });
    const fill = async (length: number) => { while (buffer.length < length) { const part = await Promise.race([reader.read(), timeout]); if (part.done) throw new MaterialError("Загрузка прервана."); buffer = Buffer.concat([buffer, part.value]); } };
    await fill(4); const length = buffer.readUInt32BE(0);
    if (!length || length > 32768) throw new MaterialError("Параметры загрузки слишком большие.", 413);
    await fill(length + 4);
    let raw: unknown; try { raw = JSON.parse(buffer.subarray(4, length + 4).toString("utf8")); } catch { throw new MaterialError("Некорректные параметры загрузки."); }
    const c = parseMaterialCommand(raw);
    let initial: Uint8Array | null = buffer.subarray(length + 4);
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) { try { if (initial) { const bytes = initial; initial = null; if (bytes.length) { controller.enqueue(bytes); return; } } const part = await reader.read(); if (part.done) { reader.releaseLock(); controller.close(); } else controller.enqueue(part.value); } catch (error) { reader.releaseLock(); controller.error(error); } },
      async cancel() { await reader.cancel(); reader.releaseLock(); },
    });
    const forwarded = new Headers(request.headers); forwarded.delete("content-length");
    return { command: c, fileRequest: new Request(request.url, { method: "POST", headers: forwarded, body: stream, duplex: "half" } as RequestInit & { duplex: string }) };
  } catch (error) { await reader.cancel().catch(() => {}); reader.releaseLock(); throw error; }
  finally { if (timer) clearTimeout(timer); }
}
export async function POST(request: Request) {
  await connection();
  let staged: Awaited<ReturnType<typeof receiveMaterialFile>> | undefined;
  try {
    if (request.headers.get("origin") !== new URL(process.env.BETTER_AUTH_URL!).origin || request.headers.get("sec-fetch-site") === "cross-site") throw new MaterialError("Источник запроса не разрешён.", 403);
    const a = await actor(request), p = new URL(request.url).searchParams;
    if ([...p.keys()].some(k => k !== "upload" || p.getAll(k).length !== 1)) throw new MaterialError("Некорректные параметры.");
    if (p.get("upload") === "1") {
      const { command: c, fileRequest } = await uploadBody(request);
      try {
        if (c.operation !== "UPLOAD") throw new MaterialError("Некорректная загрузка.");
        await requireMaterialTeaching(prisma, await materialActor(prisma, a), c.disciplineId, c.termId, c.groupIds);
        staged = await receiveMaterialFile(fileRequest);
      } catch (error) { await fileRequest.body?.cancel().catch(() => {}); throw error; }
      const result = await executeMaterialCommand(prisma, a, c, staged);
      // Retry has a new temporary blob, while the receipt retains the first one.
      if (!(await prisma.materialFile.count({ where: { key: staged.key } }))) await removeMaterialBlob(staged.key);
      staged = undefined; return response(result);
    }
    return response(await executeMaterialCommand(prisma, a, await commandBody(request)));
  } catch (error) {
    // Never remove a blob that has already been committed.
    if (staged && !(await prisma.materialFile.count({ where: { key: staged.key } }).catch(() => 1))) await removeMaterialBlob(staged.key);
    return failure(error);
  }
}
