import { NextResponse, type NextRequest } from "next/server";
import { readAuthenticatedUser } from "./lib/auth-user";
import { isRole, roleHomes } from "./lib/roles";

export async function proxy(request: NextRequest) {
  // Let Server Actions authorize writes. For page requests, send access
  // redirects before the app layouts and instant navigation checks render.
  if (request.method !== "GET" && request.method !== "HEAD") return NextResponse.next();
  const requiredRole = request.nextUrl.pathname.startsWith("/admin/") ? "ADMIN" : "STUDENT";
  const user = await readAuthenticatedUser(request.headers);
  const role = user?.role;
  if (role === requiredRole) return NextResponse.next();

  const target = role && isRole(role) ? roleHomes[role] : "/login";
  const response = NextResponse.redirect(new URL(target, process.env.BETTER_AUTH_URL ?? request.url));
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/admin/useful/:path*", "/dashboard/useful/:path*"],
};
