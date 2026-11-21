import { auth } from "@/lib/auth";
import { trustedAuthRequest } from "@/lib/auth-transport";

function error(status: number, code: string, message: string, headers?: Record<string, string>) {
  return Response.json({ code, message }, { status, headers: { "Cache-Control": "private, no-store", ...headers } });
}

async function handle(request: Request) {
  const path = new URL(request.url).pathname;
  const allowed = request.method === "GET"
    ? path === "/api/auth/get-session"
    : request.method === "POST" && ["/api/auth/sign-in/email", "/api/auth/sign-out", "/api/auth/change-password"].includes(path);

  // No public registration, user updates, role management, or account linking.
  if (!allowed) return Response.json({ error: "Маршрут недоступен" }, { status: 404 });

  const baseURL = process.env.BETTER_AUTH_URL!;
  // Reject cross-origin writes before they can consume someone else's quota.
  if (request.method === "POST" && request.headers.get("origin") !== new URL(baseURL).origin) {
    return error(403, "INVALID_ORIGIN", "Недопустимый источник запроса.");
  }
  const trusted = trustedAuthRequest(request, baseURL);
  if (!trusted) return error(403, "UNTRUSTED_PROXY", "Недопустимый источник запроса.");

  try {
    if (path === "/api/auth/sign-in/email" && request.method === "POST") {
      if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
        return error(415, "UNSUPPORTED_MEDIA_TYPE", "Требуется JSON.");
      }
    }
    const response = await auth.handler(trusted);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch {
    console.error("auth.request_failed"); // Never log request bodies or tokens.
    return error(503, "AUTH_UNAVAILABLE", "Сервис входа временно недоступен.");
  }
}

export const GET = handle;
export const POST = handle;
