import { auth } from "@/lib/auth";

async function handle(request: Request) {
  const path = new URL(request.url).pathname;
  const allowed = request.method === "GET"
    ? path === "/api/auth/get-session"
    : request.method === "POST" && ["/api/auth/sign-in/email", "/api/auth/sign-out"].includes(path);

  // No public registration, user updates, role management, or account linking.
  if (!allowed) return Response.json({ error: "Маршрут недоступен" }, { status: 404 });

  const response = await auth.handler(request);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const GET = handle;
export const POST = handle;
