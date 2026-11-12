// Shared with the maintenance script; no secrets or database access here.
export const MAX_SESSION_AGE_MS = 8 * 60 * 60 * 1000;

export function absoluteSessionExpiry(createdAt: Date | string): Date {
  return new Date(new Date(createdAt).getTime() + MAX_SESSION_AGE_MS);
}

export function isSessionWithinLifetime(session: { createdAt: Date | string; expiresAt: Date | string }, now = Date.now()): boolean {
  const createdAt = new Date(session.createdAt).getTime();
  const expiresAt = new Date(session.expiresAt).getTime();
  return Number.isFinite(createdAt) && Number.isFinite(expiresAt)
    && createdAt <= now && now < Math.min(expiresAt, createdAt + MAX_SESSION_AGE_MS);
}
