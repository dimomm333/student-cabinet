// Tab-scoped emergency recovery: no files, no durable storage on shared devices.
const prefix = "services-recovery:";
const ttl = 30 * 60 * 1000;
export function recoveryKey(owner: string, id: string) { return prefix + owner + ":" + id; }
export function readRecovery<T>(key: string): T | null {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const name = sessionStorage.key(i)!;
      if (name.startsWith(prefix) && (name.split(":")[1] !== key.split(":")[1] || JSON.parse(sessionStorage.getItem(name)!).expires < Date.now())) sessionStorage.removeItem(name);
    }
    const entry = JSON.parse(sessionStorage.getItem(key) ?? "null");
    return entry?.expires > Date.now() ? entry.value as T : null;
  } catch { return null; }
}
export function writeRecovery(key: string, value: unknown) { try { sessionStorage.setItem(key, JSON.stringify({ expires: Date.now() + ttl, value })); } catch { /* Storage may be unavailable; server saving still works. */ } }
export function clearRecovery(key?: string) {
  try { for (let i = sessionStorage.length - 1; i >= 0; i--) { const name = sessionStorage.key(i)!; if (key ? name === key : name.startsWith(prefix)) sessionStorage.removeItem(name); } } catch { /* Private browser mode. */ }
}
