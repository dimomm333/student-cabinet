import { createPrismaClient } from "../src/lib/prisma-client.ts";
import { absoluteSessionExpiry } from "../src/lib/session-policy.ts";

const db = createPrismaClient();
try {
  const sessions = await db.session.findMany({ select: { id: true, createdAt: true, expiresAt: true } });
  let capped = 0;
  for (const session of sessions) {
    const cap = absoluteSessionExpiry(session.createdAt);
    if (session.expiresAt > cap) {
      const result = await db.session.updateMany({ where: { id: session.id, expiresAt: { gt: cap } }, data: { expiresAt: cap } });
      capped += result.count;
    }
  }
  console.info({ checkedSessions: sessions.length, cappedSessions: capped, maximumAgeHours: 8 });
} finally { await db.$disconnect(); }
