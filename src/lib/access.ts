import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import type { Role } from "@/generated/prisma/enums";
import { auth } from "./auth";
import { prisma } from "./prisma";
import { isRole, roleHomes } from "./roles";
import { isSessionWithinLifetime } from "./session-policy";

// React cache deduplicates within one render only; no cross-request session cache.
export const getCurrentUser = cache(async () => {
  // Better Auth's lazy API initialization, crypto and expiry checks are all
  // request-time work. Stop prerendering before even accessing auth.api.
  // headers() alone is insufficient during navigation/prefetch validation.
  await connection();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isSessionWithinLifetime(session.session)) return null;

  // Always read the current DB role. A changed role takes effect on the next request.
  return prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, role: true },
  });
});

// Each page and each future data mutation must authorize itself, beyond the layout.
export async function requireRole(role: Role) {
  const user = await getCurrentUser();
  if (!user || !isRole(user.role)) redirect("/login");
  if (user.role !== role) redirect(roleHomes[user.role]);
  return user;
}
