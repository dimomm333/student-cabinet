import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "./prisma";
import { getScheduleApiData } from "./schedule-api-data";
import { parseScheduleApiParameters, ScheduleApiError, type ScheduleApiResource } from "./schedule-api-parameters";
import { admitScheduleApiRequest, apiSetting, cachedScheduleApiValue } from "./schedule-api-runtime";
import { isoDate } from "./schedule-calendar";

const allow = "GET, HEAD, OPTIONS";
const common = { "X-Content-Type-Options": "nosniff" };
async function withDeadline<T>(operation: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new ScheduleApiError(503, "API_TIMEOUT", "Сервис не успел обработать запрос. Повторите позже.")), 10000); })]);
  } finally { clearTimeout(timeout); }
}
function failure(status: number, code: string, message: string, headers: Record<string, string> = {}) {
  return Response.json({ error: { code, message } }, { status, headers: { ...common, "Cache-Control": "no-store", ...headers } });
}
export function scheduleApiMethodNotAllowed() { return failure(405, "METHOD_NOT_ALLOWED", "API поддерживает только чтение.", { Allow: allow }); }
export function scheduleApiOptions() { return new Response(null, { status: 204, headers: { ...common, Allow: allow, "Cache-Control": "no-store" } }); }

export async function handleScheduleApi(request: Request, resource: ScheduleApiResource) {
  try {
    const admitted = admitScheduleApiRequest(request);
    if (!admitted.allowed) return failure(429, "RATE_LIMITED", "Превышена частота запросов. Повторите позже.", { "Retry-After": String(admitted.retryAfter) });
    const parameters = parseScheduleApiParameters(resource, new URL(request.url));
    const ttl = apiSetting("SCHEDULE_API_CACHE_SECONDS", 15, 0, 60);
    // Canonical key excludes headers/cookies and collapses date aliases to Monday.
    const revision = (await prisma.scheduleWriteState.findUnique({ where: { id: "schedule" } }))?.revision ?? 0;
    const key = "v1:" + revision + ":" + resource + ":" + JSON.stringify(parameters.kind === "schedule" ? { ...parameters, week: parameters.weekNumber !== null ? null : isoDate(parameters.week) } : parameters);
    const cached = await withDeadline(cachedScheduleApiValue(key, async () => {
      const generatedAt = new Date();
      const data = await getScheduleApiData(prisma, resource, parameters);
      const body = JSON.stringify({ ...data, meta: { apiVersion: "v1", generatedAt: generatedAt.toISOString(), expiresAt: new Date(generatedAt.getTime() + ttl * 1000).toISOString() } });
      return { body, etag: '"' + createHash("sha256").update(body).digest("hex") + '"' };
    }, ttl * 1000));
    const headers = { ...common, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=0, must-revalidate", ETag: cached.etag };
    const matches = request.headers.get("if-none-match")?.split(",").some(tag => tag.trim().replace(/^W\//, "") === cached.etag || tag.trim() === "*");
    if (matches) return new Response(null, { status: 304, headers });
    return new Response(request.method === "HEAD" ? null : cached.body, { status: 200, headers });
  } catch (error) {
    if (error instanceof ScheduleApiError) return failure(error.status, error.code, error.message, error.status === 503 ? { "Retry-After": "1" } : {});
    console.error("schedule.api_unavailable");
    return failure(503, "API_UNAVAILABLE", "Расписание временно недоступно. Повторите запрос позже.", { "Retry-After": "5" });
  }
}
