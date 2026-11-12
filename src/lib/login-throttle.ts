import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { prisma } from "./prisma";

export const LOGIN_WINDOW_MS = 60_000;
export const LOGIN_ACCOUNT_LIMIT = 5;
let lastCleanup = 0;

export function normalizeLoginEmail(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 254
    ? value.trim().toLowerCase() : null;
}

export async function reserveLoginAttempt(email: string, secret: string) {
  const now = Date.now();
  // A keyed digest avoids storing pre-authentication email addresses in RateLimit.
  const key = "account:" + createHmac("sha256", secret).update(email).digest("hex");
  // One atomic statement, including across processes. Blocked requests saturate the
  // counter without sliding the window, preventing indefinite lockout by retries.
  const [row] = await prisma.$queryRaw<{ count: number; lastRequest: bigint }[]>`
    INSERT INTO "RateLimit" ("id", "key", "count", "lastRequest")
    VALUES (${randomUUID()}, ${key}, 1, ${BigInt(now)})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "lastRequest" <= ${BigInt(now - LOGIN_WINDOW_MS)} THEN 1
        ELSE MIN("count" + 1, ${LOGIN_ACCOUNT_LIMIT + 1}) END,
      "lastRequest" = CASE WHEN "lastRequest" <= ${BigInt(now - LOGIN_WINDOW_MS)}
        THEN ${BigInt(now)} ELSE "lastRequest" END
    RETURNING "count", "lastRequest"
  `;
  if (!row) throw new Error("Login limiter storage unavailable");
  if (now - lastCleanup >= 60 * 60 * 1000) {
    lastCleanup = now;
    await prisma.rateLimit.deleteMany({ where: { key: { startsWith: "account:" }, lastRequest: { lt: BigInt(now - 60 * 60 * 1000) } } });
  }
  return {
    key, windowStart: row.lastRequest,
    allowed: row.count <= LOGIN_ACCOUNT_LIMIT,
    retryAfter: Math.max(1, Math.ceil((Number(row.lastRequest) + LOGIN_WINDOW_MS - now) / 1000)),
  };
}

export async function clearSuccessfulLogin(attempt: { key: string; windowStart: bigint }) {
  // A concurrent success must not clear a later window.
  await prisma.rateLimit.deleteMany({ where: { key: attempt.key, lastRequest: attempt.windowStart } });
}
