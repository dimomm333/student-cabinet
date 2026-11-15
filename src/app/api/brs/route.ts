import { connection } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isSessionWithinLifetime } from "@/lib/session-policy";
import { BrsError, getBrsWorkspace, serializeWorkspace, type BrsActor } from "@/lib/brs-repository";
import { executeBrsCommand, type BrsCommand } from "@/lib/brs-commands";
import { DeaneryAccessDenied } from "@/lib/deanery-repository";

const responseHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
function response(value: unknown, status = 200) { return Response.json(value, { status, headers: responseHeaders }); }
async function actor(request: Request): Promise<BrsActor> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session || !isSessionWithinLifetime(session.session)) throw new BrsError("Войдите в систему.", 401);
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, role: true } });
  if (!user) throw new BrsError("Сессия недействительна.", 401);
  return { ...user, sessionId: session.session.id };
}
function errorResponse(error: unknown) {
  if (error instanceof BrsError) return response({ error: error.message }, error.status);
  if (error instanceof DeaneryAccessDenied) return response({ error: "Объект вне назначенных подразделений." }, 403);
  console.error("brs.operation_failed");
  return response({ error: "Не удалось выполнить операцию. Обновите страницу и повторите попытку." }, 500);
}
export async function GET(request: Request) {
  await connection();
  try {
    const user = await actor(request);
    const url = new URL(request.url);
    if ([...url.searchParams.keys()].some(key => key !== "planId") || url.searchParams.getAll("planId").length > 1 || (url.searchParams.get("planId")?.length ?? 0) > 128) throw new BrsError("Некорректные параметры.");
    return response(serializeWorkspace(await getBrsWorkspace(prisma, user, url.searchParams.get("planId") ?? "")));
  } catch (error) { return errorResponse(error); }
}
const fields = new Set("operation requestId planId revision groupId disciplineId termId teacherId assignmentId control moduleCount eventId moduleId studentId occurrenceId attemptId version score passed labStatus mark submittedOn checkedOn performedOn defendedOn heldOn comment commentVisible reason confirmed state title kind week plannedOn issuedOn deadline maxScore required labMinScore labRequiresDefense examOn primaryMax primaryScore scoringMode scaleVersion submissionTiming".split(" "));
async function readBody(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 32768) throw new BrsError("Запрос слишком большой.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new BrsError("Пустой запрос.");
  const chunks: Uint8Array[] = []; let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { void reader.cancel(); reject(new BrsError("Время приёма запроса истекло.", 408)); }, 10000); });
    for (;;) {
      const item = await Promise.race([reader.read(), timeout]);
      if (item.done) break;
      size += item.value.length;
      if (size > 32768) { await reader.cancel(); throw new BrsError("Запрос слишком большой.", 413); }
      chunks.push(item.value);
    }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new BrsError("Некорректный JSON."); }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !fields.has(key)) || Object.values(body).some(value => value !== null && !["string", "number", "boolean"].includes(typeof value))) throw new BrsError("Некорректные поля запроса.");
    return body as BrsCommand;
  } finally { if (timer) clearTimeout(timer); reader.releaseLock(); }
}
export async function POST(request: Request) {
  await connection();
  try {
    if (request.headers.get("origin") !== new URL(process.env.BETTER_AUTH_URL!).origin) throw new BrsError("Источник запроса не разрешён.", 403);
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new BrsError("Требуется JSON.", 415);
    const command = await readBody(request);
    // A slow upload cannot retain the session/authority from the start of a request.
    const user = await actor(request);
    const result = await executeBrsCommand(prisma, user, command);
    if (command.operation !== "PREVIEW_SCALE") for (const path of ["/dashboard", "/dashboard/grades", "/dashboard/session", "/teacher/grades", "/teacher/session", "/deanery/brs", "/deanery/grades", "/deanery/admissions", "/deanery/session"]) revalidatePath(path);
    return response(result);
  } catch (error) { return errorResponse(error); }
}
