import "server-only";
import { createHash } from "node:crypto";
import { trustedAuthRequest, VERIFIED_IP_HEADER } from "./auth-transport.ts";
import { ScheduleApiError } from "./schedule-api-parameters.ts";

type CacheEntry = { expires: number; value: unknown };
type RuntimeState = { buckets: Map<string, { count: number; until: number }>; cache: Map<string, CacheEntry>; pending: Map<string, Promise<unknown>>; active: number; generation: number };
const globalState = globalThis as unknown as { scheduleApiRuntime?: RuntimeState };
const state = globalState.scheduleApiRuntime ??= { buckets: new Map(), cache: new Map(), pending: new Map(), active: 0, generation: 0 };
state.generation ??= 0;

export function apiSetting(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const number = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(number) || number < min || number > max) throw new Error("Invalid schedule API server configuration");
  return number;
}

// In-memory admission control performs no database writes. Each Node instance
// has its own budget; production proxy must enforce an aggregate deployment cap.
export function admitScheduleApiRequest(request: Request) {
  const trusted = trustedAuthRequest(request, process.env.BETTER_AUTH_URL!);
  if (!trusted) throw new ScheduleApiError(403, "UNTRUSTED_PROXY", "Запрос должен поступать через доверенный proxy.");
  const address = trusted.headers.get(VERIFIED_IP_HEADER) ?? "direct";
  const key = createHash("sha256").update(address).digest("hex");
  const now = Date.now(), window = 60000;
  for (const [id, bucket] of state.buckets) if (bucket.until <= now) state.buckets.delete(id);
  const global = state.buckets.get("global") ?? { count: 0, until: now + window };
  const client = state.buckets.get(key) ?? { count: 0, until: now + window };
  const clientLimit = apiSetting("SCHEDULE_API_RATE_LIMIT", 60, 1, 10000);
  const globalLimit = apiSetting("SCHEDULE_API_GLOBAL_LIMIT", 600, 1, 100000);
  if (global.count >= globalLimit || client.count >= clientLimit || (!state.buckets.has(key) && state.buckets.size >= 4096)) {
    const until = Math.max(global.count >= globalLimit ? global.until : now, client.count >= clientLimit ? client.until : now, state.buckets.size >= 4096 ? now + window : now);
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((until - now) / 1000)) };
  }
  global.count++; client.count++;
  state.buckets.set("global", global); state.buckets.set(key, client);
  return { allowed: true, retryAfter: 0 };
}

// Public projections only. Bounded memory, fixed TTL and coalesced cache misses.
export async function cachedScheduleApiValue<T>(key: string, load: () => Promise<T>, ttlMs: number): Promise<T> {
  const now = Date.now(), entry = state.cache.get(key);
  if (entry && entry.expires > now) return entry.value as T;
  const pending = state.pending.get(key);
  if (pending) return pending as Promise<T>;
  if (state.active >= apiSetting("SCHEDULE_API_CONCURRENCY", 4, 1, 32)) throw new ScheduleApiError(503, "API_BUSY", "Сервис занят. Повторите запрос позже.");
  state.active++;
  const generation = state.generation;
  const promise = (async () => {
    try {
      const value = await Promise.resolve().then(load);
      if (ttlMs > 0 && generation === state.generation) {
        for (const [id, cached] of state.cache) if (cached.expires <= Date.now()) state.cache.delete(id);
        if (state.cache.size >= 128) state.cache.delete(state.cache.keys().next().value!);
        state.cache.set(key, { value, expires: now + ttlMs });
      }
      return value;
    } finally {
      state.active--;
      if (generation === state.generation) state.pending.delete(key);
    }
  })();
  state.pending.set(key, promise);
  return promise;
}
// Internal only: future authorized schedule writes call this after committing.
// There is deliberately no public endpoint for clearing or extending the cache.
export function invalidateScheduleApiCache() { state.generation++; state.cache.clear(); state.pending.clear(); }
