import "server-only";
import { auth } from "./auth";
import { prisma } from "./prisma";
import { isSessionWithinLifetime } from "./session-policy";

export async function readAuthenticatedUser(headers: Headers) {
  const session = await auth.api.getSession({ headers });
  if (!session || !isSessionWithinLifetime(session.session)) return null;

  return prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, role: true },
  });
}
